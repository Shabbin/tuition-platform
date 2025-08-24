// server/controllers/paymentController.js
require('dotenv').config();
const SSLCommerz = require('sslcommerz-lts');
const User = require('../models/user');
const TeacherRequest = require('../models/teacherRequest');
const Payment = require('../models/payment');
const Notification = require('../models/Notification');
const { TOPIC_PACK_PRICE, TOPIC_PACK_CREDITS } = require('../config/billing');

const is_live = String(process.env.SSLCZ_LIVE).toLowerCase() === 'true';
const store_id = process.env.SSLCZ_STORE_ID;
const store_passwd = process.env.SSLCZ_STORE_PASSWD;

const attempts = global.__paymentAttempts || new Map();
global.__paymentAttempts = attempts;

const baseUrl = () =>
  process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

// ---------- helpers ----------
function appendQuery(url, params) {
  try {
    const u = new URL(url);
    Object.entries(params || {}).forEach(([k, v]) => u.searchParams.set(k, String(v)));
    return u.toString();
  } catch {
    return url;
  }
}
function tuitionRate(phase, monthIndex) {
  if (phase === 'FIRST') return 0.30;
  if (Number(monthIndex) >= 2) return 0.15;
  return 0.30;
}
function safeParseMeta(s) {
  try { return s ? JSON.parse(s) : null; } catch { return null; }
}

// Resolve an approved TeacherRequest by id OR (student+teacher+post) OR (student+teacher)
async function resolveApprovedRequest({ requestId, studentId, teacherId, postId }) {
  if (requestId) {
    const doc = await TeacherRequest.findOne({ _id: requestId, status: 'approved' })
      .select('_id studentId teacherId postId')
      .lean();
    if (doc) return doc;
  }
  if (studentId && teacherId && postId) {
    const doc = await TeacherRequest.findOne({ studentId, teacherId, postId, status: 'approved' })
      .select('_id studentId teacherId postId')
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();
    if (doc) return doc;
  }
  if (studentId && teacherId) {
    const doc = await TeacherRequest.findOne({ studentId, teacherId, status: 'approved' })
      .select('_id studentId teacherId postId')
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();
    if (doc) return doc;
  }
  return null;
}

// ====================== Topic Pack (৳400 → 10 credits) ======================
exports.initiate = async (req, res) => {
  try {
    const type = String(req.body.type || 'TOPIC_PACK_10');
    const studentId = req.body.studentId; // REQUIRED to persist credits
    const returnUrl = req.body.returnUrl; // optional
    if (!studentId) return res.status(400).json({ error: 'studentId is required' });

    const orderId = String(req.body.orderId || `TP-${Date.now()}`);
    const tran_id = `ORD-${orderId}-${Date.now()}`;
    const amount = (type === 'TOPIC_PACK_10' ? TOPIC_PACK_PRICE : Number(100)).toFixed(2);

    const data = {
      total_amount: amount,
      currency: 'BDT',
      tran_id,
      success_url: `${baseUrl()}/pay/success`,
      fail_url:    `${baseUrl()}/pay/fail`,
      cancel_url:  `${baseUrl()}/pay/cancel`,
      ipn_url:     `${baseUrl()}/pay/ipn`,
      product_name: 'Topic Help Pack (10)',
      product_category: 'education',
      product_profile: 'non-physical-goods',
      emi_option: 0,
      shipping_method: 'NO',
      num_of_item: 1,
      cus_name: 'Student',
      cus_email: 'student@example.com',
      cus_add1: 'Dhaka',
      cus_city: 'Dhaka',
      cus_postcode: '1212',
      cus_country: 'Bangladesh',
      cus_phone: '01700000000',
      value_a: returnUrl || req.headers.referer || '',
      value_b: JSON.stringify({ type: 'TOPIC_PACK_10', studentId, amount: Number(amount) })
    };

    const sslcz = new SSLCommerz(store_id, store_passwd, is_live);
    const apiRes = await sslcz.init(data);
    if (!apiRes?.GatewayPageURL) return res.status(500).json({ error: 'GatewayPageURL missing', apiRes });

    attempts.set(tran_id, { type: 'TOPIC_PACK_10', amount: Number(amount), studentId, returnUrl: data.value_a });
    return res.json({ url: apiRes.GatewayPageURL, tran_id });
  } catch (err) {
    console.error('initiate:', err);
    res.status(500).json({ error: 'Failed to initiate', message: err.message });
  }
};

// ============================ Tuition Payments ==============================
exports.initiateTuition = async (req, res) => {
  try {
    const {
      requestId, studentId: bodyStudentId, teacherId, postId,
      monthlyFee, phase = 'FIRST', fraction, monthIndex = 1, returnUrl
    } = req.body;

    const effectiveStudentId = bodyStudentId || req.user?.id;

    // resolve the approved TeacherRequest
    const reqDoc = await resolveApprovedRequest({
      requestId,
      studentId: effectiveStudentId,
      teacherId,
      postId
    });
    if (!reqDoc) return res.status(404).json({ error: 'Approved TeacherRequest not found' });

    const fee = Number(monthlyFee);
    if (!fee || fee <= 0) return res.status(400).json({ error: 'monthlyFee must be positive' });

    const f = phase === 'FIRST' && Number(fraction) === 0.5 ? 0.5 : 1;
    const amountNum = phase === 'FIRST' ? fee * f : fee;
    const amount = amountNum.toFixed(2);

    // ✅ always tie order/meta to the resolved request id
    const resolvedRequestId = String(reqDoc._id);
    const orderId = `TUITION-${resolvedRequestId}-${Date.now()}`;
    const tran_id = `ORD-${orderId}`;

    const data = {
      total_amount: amount,
      currency: 'BDT',
      tran_id,
      success_url: `${baseUrl()}/pay/success`,
      fail_url:    `${baseUrl()}/pay/fail`,
      cancel_url:  `${baseUrl()}/pay/cancel`,
      ipn_url:     `${baseUrl()}/pay/ipn`,
      product_name: (phase === 'FIRST'
        ? `Tuition First Payment (${f === 0.5 ? '50%' : '100%'})`
        : `Tuition Month ${monthIndex}`),
      product_category: 'education',
      product_profile: 'non-physical-goods',
      emi_option: 0,
      shipping_method: 'NO',
      num_of_item: 1,
      cus_name: 'Student',
      cus_email: 'student@example.com',
      cus_add1: 'Dhaka',
      cus_city: 'Dhaka',
      cus_postcode: '1212',
      cus_country: 'Bangladesh',
      cus_phone: '01700000000',
      value_a: returnUrl || req.headers.referer || '',
      value_b: JSON.stringify({
        type: 'TUITION',
        requestId: resolvedRequestId,             // 👈 persist requestId in meta
        monthlyFee: fee, phase, fraction: f, monthIndex,
        studentId: reqDoc.studentId, teacherId: reqDoc.teacherId, postId: reqDoc.postId || null,
        amount: Number(amount)
      })
    };

    const sslcz = new SSLCommerz(store_id, store_passwd, is_live);
    const apiRes = await sslcz.init(data);
    if (!apiRes?.GatewayPageURL) {
      return res.status(500).json({ error: 'GatewayPageURL missing', apiRes });
    }

    attempts.set(tran_id, {
      type: 'TUITION',
      amount: Number(amount),
      monthlyFee: fee,
      phase, fraction: f, monthIndex: Number(monthIndex),
      requestId: resolvedRequestId,               // 👈 also persist here
      studentId: reqDoc.studentId,
      teacherId: reqDoc.teacherId,
      postId: reqDoc.postId || null,
      returnUrl: data.value_a
    });

    return res.json({ url: apiRes.GatewayPageURL, tran_id });
  } catch (err) {
    console.error('initiateTuition:', err);
    res.status(500).json({ error: 'Failed to initiate tuition payment', message: err.message });
  }
};

// ============================ Gateway Callbacks =============================
exports.success = async (req, res) => {
  try {
    const { val_id, tran_id, value_a } = req.body || {};
    if (!val_id || !tran_id) return res.status(400).send('Missing val_id/tran_id');

    const u = new URL('https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php');
    if (is_live) u.host = 'securepay.sslcommerz.com';
    u.searchParams.set('val_id', val_id);
    u.searchParams.set('store_id', store_id);
    u.searchParams.set('store_passwd', store_passwd);
    u.searchParams.set('format', 'json');

    const v = await (await fetch(u)).json();
    const meta = attempts.get(tran_id) || safeParseMeta(req.body.value_b);
    const amountMatches = meta && Number(v.amount) === Number(meta.amount);
    const ok = (v.status === 'VALID' || v.status === 'VALIDATED') && amountMatches;

    if (!ok) {
      return res.status(400).send(`<h2>⚠️ Validation failed</h2><pre>${JSON.stringify({ v, meta }, null, 2)}</pre>`);
    }

    // -------- Topic Pack --------
    if (meta?.type === 'TOPIC_PACK_10') {
      await User.updateOne({ _id: meta.studentId }, { $inc: { topicCredits: TOPIC_PACK_CREDITS } });
      await Payment.create({
        type: 'TOPIC_PACK',
        studentId: meta.studentId,
        amount: meta.amount,
        tran_id,
        bank_tran_id: v.bank_tran_id,
        status: 'PAID'
      });
      attempts.delete(tran_id);

      if (value_a) {
        const back = appendQuery(value_a, { paid: 1, type: meta.type || 'PAYMENT', tran_id, amt: meta.amount });
        return res.redirect(302, back);
      }

      return res.status(200).send(`
        <h2>✅ Topic Pack Purchased</h2>
        <pre>${JSON.stringify({ studentId: meta.studentId, creditsAdded: TOPIC_PACK_CREDITS, amount: meta.amount }, null, 2)}</pre>
      `);
    }

    // -------- Tuition --------
    if (meta?.type === 'TUITION') {
      const rate = tuitionRate(meta.phase, meta.monthIndex);
      const yourShare  = +(meta.amount * rate).toFixed(2);
      const teacherNet = +(meta.amount - yourShare).toFixed(2);

      // ✅ ensure we have a requestId (double safety)
      let ensuredRequestId = meta.requestId || null;
      if (!ensuredRequestId) {
        const resolved = await resolveApprovedRequest({
          requestId: null,
          studentId: meta.studentId,
          teacherId: meta.teacherId,
          postId: meta.postId || null,
        });
        ensuredRequestId = resolved?._id?.toString() || null;
      }

      await Payment.create({
        type: 'TUITION',
        requestId: ensuredRequestId,
        studentId: meta.studentId,
        teacherId: meta.teacherId,
        amount: meta.amount,
        commissionRate: rate,
        yourShare,
        teacherShare: teacherNet,
        phase: meta.phase,
        monthIndex: meta.monthIndex,
        tran_id,
        bank_tran_id: v.bank_tran_id,
        status: 'PAID'
      });

      // stamp TeacherRequest for first payment
      if (meta.phase === 'FIRST' && ensuredRequestId) {
        await TeacherRequest.updateOne(
          { _id: ensuredRequestId },
          { $set: { firstPaidAt: new Date(), 'firstPayment.fraction': meta.fraction || 1, 'firstPayment.amount': meta.amount } }
        );
      }

      // notify student & teacher
      const [student, teacher] = await Promise.all([
        User.findById(meta.studentId).select('name profileImage'),
        User.findById(meta.teacherId).select('name profileImage'),
      ]);

      const notifStudent = new Notification({
        userId: meta.studentId,
        senderId: meta.teacherId,
        senderName: teacher?.name || 'Teacher',
        profileImage: teacher?.profileImage || '/default-avatar.png',
        type: 'payment_success',
        title: 'Payment Successful',
        message: `You are now enrolled with ${teacher?.name || 'your teacher'}.`,
        data: { requestId: ensuredRequestId, teacherId: meta.teacherId, amount: meta.amount, phase: meta.phase, monthIndex: meta.monthIndex },
        read: false,
      });
      await notifStudent.save();

      const notifTeacher = new Notification({
        userId: meta.teacherId,
        senderId: meta.studentId,
        senderName: student?.name || 'Student',
        profileImage: student?.profileImage || '/default-avatar.png',
        type: 'payment_success',
        title: 'New Tuition Payment',
        message: `${student?.name || 'A student'} just paid ৳${meta.amount}.`,
        data: { requestId: ensuredRequestId, studentId: meta.studentId, amount: meta.amount, phase: meta.phase, monthIndex: meta.monthIndex },
        read: false,
      });
      await notifTeacher.save();

      if (global.emitToUser) {
        global.emitToUser(String(meta.studentId), 'new_notification', {
          _id: String(notifStudent._id),
          senderId: notifStudent.senderId,
          senderName: notifStudent.senderName,
          profileImage: notifStudent.profileImage,
          type: notifStudent.type,
          title: notifStudent.title,
          message: notifStudent.message,
          data: notifStudent.data,
          read: notifStudent.read,
          createdAt: notifStudent.createdAt,
        });
        global.emitToUser(String(meta.teacherId), 'new_notification', {
          _id: String(notifTeacher._id),
          senderId: notifTeacher.senderId,
          senderName: notifTeacher.senderName,
          profileImage: notifTeacher.profileImage,
          type: notifTeacher.type,
          title: notifTeacher.title,
          message: notifTeacher.message,
          data: notifTeacher.data,
          read: notifTeacher.read,
          createdAt: notifTeacher.createdAt,
        });
      }

      attempts.delete(tran_id);

      if (value_a) {
        const back = appendQuery(value_a, { paid: 1, type: meta.type || 'PAYMENT', tran_id, amt: meta.amount, phase: meta.phase, month: meta.monthIndex });
        return res.redirect(302, back);
      }

      return res.status(200).send(`
        <h2>✅ Tuition Payment Success</h2>
        <pre>${JSON.stringify({
          requestId: ensuredRequestId,
          studentId: meta.studentId,
          teacherId: meta.teacherId,
          phase: meta.phase,
          monthIndex: meta.monthIndex,
          amount: meta.amount,
          commissionRate: rate,
          yourShare,
          teacherNet,
          bankTxn: v.bank_tran_id
        }, null, 2)}</pre>
      `);
    }

    // fallback
    if (value_a) {
      const back = appendQuery(value_a, { paid: 1, type: 'PAYMENT', tran_id, amt: v.amount });
      return res.redirect(302, back);
    }
    return res.status(200).send(`<h2>✅ Payment Success</h2><pre>${JSON.stringify(v, null, 2)}</pre>`);
  } catch (err) {
    console.error('success:', err);
    res.status(500).send(`<pre>${err.message}</pre>`);
  }
};

exports.fail = async (req, res) => {
  try {
    const { tran_id, value_a } = req.body || {};
    attempts.delete(tran_id);
    if (value_a) {
      const meta = safeParseMeta(req.body?.value_b);
      const back = appendQuery(value_a, { paid: 0, status: 'fail', type: meta?.type || 'PAYMENT', tran_id: tran_id || '' });
      return res.redirect(302, back);
    }
    return res.status(200).send('<h2>❌ Payment Failed</h2>');
  } catch {
    return res.status(200).send('<h2>❌ Payment Failed</h2>');
  }
};

exports.cancel = async (req, res) => {
  try {
    const { tran_id, value_a } = req.body || {};
    attempts.delete(tran_id);
    if (value_a) {
      const meta = safeParseMeta(req.body?.value_b);
      const back = appendQuery(value_a, { paid: 0, status: 'cancel', type: meta?.type || 'PAYMENT', tran_id: tran_id || '' });
      return res.redirect(302, back);
    }
    return res.status(200).send('<h2>🛑 Payment Cancelled</h2>');
  } catch {
    return res.status(200).send('<h2>🛑 Payment Cancelled</h2>');
  }
};

exports.ipn = async (req, res) => {
  try {
    // Optionally: validate using req.body.val_id and upsert Payment idempotently
    res.status(200).end();
  } catch {
    res.status(200).end();
  }
};


// GET /api/pay/teacher/summary  (auth: teacher)
// Returns this month's PAID payments for the logged-in teacher + quick totals
exports.getTeacherSummary = async (req, res) => {
  try {
    const teacherId = req.user.id;
    const start = new Date();
    start.setDate(1);
    start.setHours(0,0,0,0);

    const payments = await Payment.find({
      teacherId,
      status: 'PAID',
      createdAt: { $gte: start },
    })
      .select('amount commissionRate teacherShare yourShare createdAt')
      .sort({ createdAt: -1 })
      .lean();

    const sum = (arr, fn) => arr.reduce((a, x) => a + (Number(fn(x)) || 0), 0);

    const monthlyEarnings = sum(payments, (p) =>
      typeof p.teacherShare === 'number'
        ? p.teacherShare
        : (Number(p.amount) || 0) - (Number(p.amount) || 0) * (Number(p.commissionRate) || 0)
    );

    const commissionPaid = sum(payments, (p) =>
      typeof p.yourShare === 'number'
        ? p.yourShare
        : (Number(p.amount) || 0) * (Number(p.commissionRate) || 0)
    );

    return res.json({
      payments,
      summary: {
        monthlyEarnings: Math.round(monthlyEarnings),
        commissionPaid: Math.round(commissionPaid),
        count: payments.length,
      },
    });
  } catch (err) {
    console.error('getTeacherSummary', err);
    return res.status(500).json({ error: 'Server error' });
  }
};









// require('dotenv').config();
// const SSLCommerz = require('sslcommerz-lts');
// const User = require('../models/user');
// const TeacherRequest = require('../models/teacherRequest');
// const Payment = require('../models/payment');
// const Notification = require('../models/Notification'); // 👈 NEW
// const {
//   TOPIC_PACK_PRICE, TOPIC_PACK_CREDITS
// } = require('../config/billing');

// const is_live = String(process.env.SSLCZ_LIVE).toLowerCase() === 'true';
// const store_id = process.env.SSLCZ_STORE_ID;
// const store_passwd = process.env.SSLCZ_STORE_PASSWD;

// const attempts = global.__paymentAttempts || new Map();
// global.__paymentAttempts = attempts;

// const baseUrl = () =>
//   process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

// // small helper to append query params to a given URL
// function appendQuery(url, params) {
//   try {
//     const u = new URL(url);
//     Object.entries(params || {}).forEach(([k, v]) => u.searchParams.set(k, String(v)));
//     return u.toString();
//   } catch {
//     return url;
//   }
// }

// function tuitionRate(phase, monthIndex) {
//   if (phase === 'FIRST') return 0.30;
//   if (Number(monthIndex) >= 2) return 0.15;
//   return 0.30;
// }

// function safeParseMeta(s) {
//   try { return s ? JSON.parse(s) : null; } catch { return null; }
// }

// // ====================== Topic Pack (৳400 → 10 credits) ======================
// exports.initiate = async (req, res) => {
//   try {
//     const type = String(req.body.type || 'TOPIC_PACK_10');
//     const studentId = req.body.studentId; // REQUIRED to persist credits
//     const returnUrl = req.body.returnUrl; // optional
//     if (!studentId) return res.status(400).json({ error: 'studentId is required' });

//     const orderId = String(req.body.orderId || `TP-${Date.now()}`);
//     const tran_id = `ORD-${orderId}-${Date.now()}`;
//     const amount = (type === 'TOPIC_PACK_10' ? TOPIC_PACK_PRICE : Number(100)).toFixed(2);

//     const data = {
//       total_amount: amount,
//       currency: 'BDT',
//       tran_id,
//       success_url: `${baseUrl()}/pay/success`,
//       fail_url:    `${baseUrl()}/pay/fail`,
//       cancel_url:  `${baseUrl()}/pay/cancel`,
//       ipn_url:     `${baseUrl()}/pay/ipn`,

//       product_name: 'Topic Help Pack (10)',
//       product_category: 'education',
//       product_profile: 'non-physical-goods',
//       emi_option: 0,
//       shipping_method: 'NO',
//       num_of_item: 1,

//       cus_name: 'Student',
//       cus_email: 'student@example.com',
//       cus_add1: 'Dhaka',
//       cus_city: 'Dhaka',
//       cus_postcode: '1212',
//       cus_country: 'Bangladesh',
//       cus_phone: '01700000000',

//       // carry return target + meta
//       value_a: returnUrl || req.headers.referer || '',
//       value_b: JSON.stringify({ type: 'TOPIC_PACK_10', studentId, amount: Number(amount) })
//     };

//     const sslcz = new SSLCommerz(store_id, store_passwd, is_live);
//     const apiRes = await sslcz.init(data);
//     if (!apiRes?.GatewayPageURL) return res.status(500).json({ error: 'GatewayPageURL missing', apiRes });

//     attempts.set(tran_id, { type: 'TOPIC_PACK_10', amount: Number(amount), studentId, returnUrl: data.value_a });
//     return res.json({ url: apiRes.GatewayPageURL, tran_id });
//   } catch (err) {
//     console.error('initiate:', err);
//     res.status(500).json({ error: 'Failed to initiate', message: err.message });
//   }
// };

// // ============================ Tuition Payments ==============================
// // Helper: resolve an approved TeacherRequest either by requestId OR (studentId+teacherId+postId)
// // --- add this helper near the top of the file ---
// async function resolveApprovedRequest({ requestId, studentId, teacherId, postId }) {
//   // 1) explicit requestId
//   if (requestId) {
//     const doc = await TeacherRequest.findOne({ _id: requestId, status: 'approved' })
//       .select('_id studentId teacherId postId')
//       .lean();
//     if (doc) return doc;
//   }

//   // 2) exact match on student + teacher + post
//   if (studentId && teacherId && postId) {
//     const doc = await TeacherRequest.findOne({
//       studentId, teacherId, postId, status: 'approved',
//     })
//       .select('_id studentId teacherId postId')
//       .sort({ updatedAt: -1, createdAt: -1 })
//       .lean();
//     if (doc) return doc;
//   }

//   // 3) fallback: student + teacher (when postId not provided or no exact match)
//   if (studentId && teacherId) {
//     const doc = await TeacherRequest.findOne({
//       studentId, teacherId, status: 'approved',
//     })
//       .select('_id studentId teacherId postId')
//       .sort({ updatedAt: -1, createdAt: -1 })
//       .lean();
//     if (doc) return doc;
//   }

//   return null;
// }


// // --- replace your exports.initiateTuition with this ---
// exports.initiateTuition = async (req, res) => {
//   try {
//     const {
//       requestId, studentId: bodyStudentId, teacherId, postId,
//       monthlyFee, phase = 'FIRST', fraction, monthIndex = 1, returnUrl
//     } = req.body;

//     // derive student from auth if not provided
//     const effectiveStudentId = bodyStudentId || req.user?.id;

//     // find the approved TeacherRequest
//     const reqDoc = await resolveApprovedRequest({
//       requestId,
//       studentId: effectiveStudentId,
//       teacherId,
//       postId
//     });
//     if (!reqDoc) {
//       return res.status(404).json({ error: 'Approved TeacherRequest not found' });
//     }

//     const fee = Number(monthlyFee);
//     if (!fee || fee <= 0) {
//       return res.status(400).json({ error: 'monthlyFee must be positive' });
//     }

//     const f = phase === 'FIRST' && Number(fraction) === 0.5 ? 0.5 : 1;
//     const amountNum = phase === 'FIRST' ? fee * f : fee;
//     const amount = amountNum.toFixed(2);

//     const orderId = `TUITION-${(requestId || `${reqDoc.studentId}-${reqDoc.teacherId}-${reqDoc.postId || 'any'}`)}-${Date.now()}`;
//     const tran_id = `ORD-${orderId}`;

//     const data = {
//       total_amount: amount,
//       currency: 'BDT',
//       tran_id,
//       success_url: `${baseUrl()}/pay/success`,
//       fail_url:    `${baseUrl()}/pay/fail`,
//       cancel_url:  `${baseUrl()}/pay/cancel`,
//       ipn_url:     `${baseUrl()}/pay/ipn`,
//       product_name: (phase === 'FIRST'
//         ? `Tuition First Payment (${f === 0.5 ? '50%' : '100%'})`
//         : `Tuition Month ${monthIndex}`),
//       product_category: 'education',
//       product_profile: 'non-physical-goods',
//       emi_option: 0,
//       shipping_method: 'NO',
//       num_of_item: 1,
//       cus_name: 'Student',
//       cus_email: 'student@example.com',
//       cus_add1: 'Dhaka',
//       cus_city: 'Dhaka',
//       cus_postcode: '1212',
//       cus_country: 'Bangladesh',
//       cus_phone: '01700000000',
//       value_a: returnUrl || req.headers.referer || '',
//       value_b: JSON.stringify({
//         type: 'TUITION',
//         requestId: requestId || null,
//         monthlyFee: fee, phase, fraction: f, monthIndex,
//         studentId: reqDoc.studentId, teacherId: reqDoc.teacherId, postId: reqDoc.postId || null,
//         amount: Number(amount)
//       })
//     };

//     const sslcz = new SSLCommerz(store_id, store_passwd, is_live);
//     const apiRes = await sslcz.init(data);
//     if (!apiRes?.GatewayPageURL) {
//       return res.status(500).json({ error: 'GatewayPageURL missing', apiRes });
//     }

//     attempts.set(tran_id, {
//       type: 'TUITION',
//       amount: Number(amount),
//       monthlyFee: fee,
//       phase, fraction: f, monthIndex: Number(monthIndex),
//       requestId: requestId || null,
//       studentId: reqDoc.studentId,
//       teacherId: reqDoc.teacherId,
//       postId: reqDoc.postId || null,
//       returnUrl: data.value_a
//     });

//     return res.json({ url: apiRes.GatewayPageURL, tran_id });
//   } catch (err) {
//     console.error('initiateTuition:', err);
//     res.status(500).json({ error: 'Failed to initiate tuition payment', message: err.message });
//   }
// };


// // ============================ Gateway Callbacks =============================
// exports.success = async (req, res) => {
//   try {
//     const { val_id, tran_id, value_a } = req.body || {};
//     if (!val_id || !tran_id) return res.status(400).send('Missing val_id/tran_id');

//     const u = new URL('https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php');
//     if (is_live) u.host = 'securepay.sslcommerz.com';
//     u.searchParams.set('val_id', val_id);
//     u.searchParams.set('store_id', store_id);
//     u.searchParams.set('store_passwd', store_passwd);
//     u.searchParams.set('format', 'json');

//     const v = await (await fetch(u)).json();
//     const meta = attempts.get(tran_id) || safeParseMeta(req.body.value_b);
//     const amountMatches = meta && Number(v.amount) === Number(meta.amount);
//     const ok = (v.status === 'VALID' || v.status === 'VALIDATED') && amountMatches;

//     if (!ok) {
//       return res.status(400).send(`<h2>⚠️ Validation failed</h2><pre>${JSON.stringify({ v, meta }, null, 2)}</pre>`);
//     }

//     // -------- Topic Pack: credit + persist payment ----------
//     if (meta?.type === 'TOPIC_PACK_10') {
//       await User.updateOne(
//         { _id: meta.studentId },
//         { $inc: { topicCredits: TOPIC_PACK_CREDITS } }
//       );
//       await Payment.create({
//         type: 'TOPIC_PACK',
//         studentId: meta.studentId,
//         amount: meta.amount,
//         tran_id,
//         bank_tran_id: v.bank_tran_id,
//         status: 'PAID'
//       });
//       attempts.delete(tran_id);

//       if (value_a) {
//         const back = appendQuery(value_a, {
//           paid: 1, type: meta.type || 'PAYMENT', tran_id, amt: meta.amount
//         });
//         return res.redirect(302, back);
//       }

//       return res.status(200).send(`
//         <h2>✅ Topic Pack Purchased</h2>
//         <pre>${JSON.stringify({
//           studentId: meta.studentId,
//           creditsAdded: TOPIC_PACK_CREDITS,
//           amount: meta.amount
//         }, null, 2)}</pre>
//       `);
//     }

//     // -------- Tuition: compute split + persist payment + update request + notify ------
//     if (meta?.type === 'TUITION') {
//       const rate = tuitionRate(meta.phase, meta.monthIndex);   // 0.30 or 0.15
//       const yourShare  = +(meta.amount * rate).toFixed(2);
//       const teacherNet = +(meta.amount - yourShare).toFixed(2);

//       await Payment.create({
//         type: 'TUITION',
//         requestId: meta.requestId,            // can be null if resolved by trio; eligibility query uses this, so prefer passing requestId from UI when available
//         studentId: meta.studentId,
//         teacherId: meta.teacherId,
//         amount: meta.amount,
//         commissionRate: rate,
//         yourShare,
//         teacherShare: teacherNet,
//         phase: meta.phase,
//         monthIndex: meta.monthIndex,
//         tran_id,
//         bank_tran_id: v.bank_tran_id,
//         status: 'PAID'
//       });

//       // If first payment: stamp TeacherRequest
//       if (meta.phase === 'FIRST' && meta.requestId) {
//         await TeacherRequest.updateOne(
//           { _id: meta.requestId },
//           {
//             $set: {
//               firstPaidAt: new Date(),
//               firstPayment: { fraction: meta.fraction || 1, amount: meta.amount }
//             }
//           }
//         );
//       }

//       // Notify both sides
//       const [student, teacher] = await Promise.all([
//         User.findById(meta.studentId).select('name profileImage'),
//         User.findById(meta.teacherId).select('name profileImage'),
//       ]);

//       // to student
//       const notifStudent = new Notification({
//         userId: meta.studentId,
//         senderId: meta.teacherId,
//         senderName: teacher?.name || 'Teacher',
//         profileImage: teacher?.profileImage || '/default-avatar.png',
//         type: 'payment_success',
//         title: 'Payment Successful',
//         message: `You are now enrolled with ${teacher?.name || 'your teacher'}.`,
//         data: {
//           requestId: meta.requestId || null,
//           teacherId: meta.teacherId,
//           amount: meta.amount,
//           phase: meta.phase,
//           monthIndex: meta.monthIndex,
//         },
//         read: false,
//       });
//       await notifStudent.save();

//       // to teacher
//       const notifTeacher = new Notification({
//         userId: meta.teacherId,
//         senderId: meta.studentId,
//         senderName: student?.name || 'Student',
//         profileImage: student?.profileImage || '/default-avatar.png',
//         type: 'payment_success',
//         title: 'New Tuition Payment',
//         message: `${student?.name || 'A student'} just paid ৳${meta.amount}.`,
//         data: {
//           requestId: meta.requestId || null,
//           studentId: meta.studentId,
//           amount: meta.amount,
//           phase: meta.phase,
//           monthIndex: meta.monthIndex,
//         },
//         read: false,
//       });
//       await notifTeacher.save();

//       // sockets
//       if (global.emitToUser) {
//         global.emitToUser(String(meta.studentId), 'new_notification', {
//           _id: String(notifStudent._id),
//           senderId: notifStudent.senderId,
//           senderName: notifStudent.senderName,
//           profileImage: notifStudent.profileImage,
//           type: notifStudent.type,
//           title: notifStudent.title,
//           message: notifStudent.message,
//           data: notifStudent.data,
//           read: notifStudent.read,
//           createdAt: notifStudent.createdAt,
//         });
//         global.emitToUser(String(meta.teacherId), 'new_notification', {
//           _id: String(notifTeacher._id),
//           senderId: notifTeacher.senderId,
//           senderName: notifTeacher.senderName,
//           profileImage: notifTeacher.profileImage,
//           type: notifTeacher.type,
//           title: notifTeacher.title,
//           message: notifTeacher.message,
//           data: notifTeacher.data,
//           read: notifTeacher.read,
//           createdAt: notifTeacher.createdAt,
//         });
//       }

//       attempts.delete(tran_id);

//       if (value_a) {
//         const back = appendQuery(value_a, {
//           paid: 1, type: meta.type || 'PAYMENT', tran_id, amt: meta.amount,
//           phase: meta.phase, month: meta.monthIndex
//         });
//         return res.redirect(302, back);
//       }

//       return res.status(200).send(`
//         <h2>✅ Tuition Payment Success</h2>
//         <pre>${JSON.stringify({
//           requestId: meta.requestId || null,
//           studentId: meta.studentId,
//           teacherId: meta.teacherId,
//           phase: meta.phase,
//           monthIndex: meta.monthIndex,
//           amount: meta.amount,
//           commissionRate: rate,
//           yourShare,
//           teacherNet,
//           bankTxn: v.bank_tran_id
//         }, null, 2)}</pre>
//       `);
//     }

//     // Fallback
//     if (value_a) {
//       const back = appendQuery(value_a, { paid: 1, type: 'PAYMENT', tran_id, amt: v.amount });
//       return res.redirect(302, back);
//     }
//     return res.status(200).send(`<h2>✅ Payment Success</h2><pre>${JSON.stringify(v, null, 2)}</pre>`);
//   } catch (err) {
//     console.error('success:', err);
//     res.status(500).send(`<pre>${err.message}</pre>`);
//   }
// };

// exports.fail = async (req, res) => {
//   try {
//     const { tran_id, value_a } = req.body || {};
//     attempts.delete(tran_id);
//     if (value_a) {
//       const meta = safeParseMeta(req.body?.value_b);
//       const back = appendQuery(value_a, {
//         paid: 0, status: 'fail', type: meta?.type || 'PAYMENT', tran_id: tran_id || ''
//       });
//       return res.redirect(302, back);
//     }
//     return res.status(200).send('<h2>❌ Payment Failed</h2>');
//   } catch (e) {
//     return res.status(200).send('<h2>❌ Payment Failed</h2>');
//   }
// };

// exports.cancel = async (req, res) => {
//   try {
//     const { tran_id, value_a } = req.body || {};
//     attempts.delete(tran_id);
//     if (value_a) {
//       const meta = safeParseMeta(req.body?.value_b);
//       const back = appendQuery(value_a, {
//         paid: 0, status: 'cancel', type: meta?.type || 'PAYMENT', tran_id: tran_id || ''
//       });
//       return res.redirect(302, back);
//     }
//     return res.status(200).send('<h2>🛑 Payment Cancelled</h2>');
//   } catch (e) {
//     return res.status(200).send('<h2>🛑 Payment Cancelled</h2>');
//   }
// };

// exports.ipn = async (req, res) => {
//   try {
//     // Optionally: repeat the same validation here using req.body.val_id and upsert Payment (idempotent)
//     res.status(200).end();
//   } catch {
//     res.status(200).end();
//   }
// };
