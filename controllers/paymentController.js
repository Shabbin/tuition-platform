require('dotenv').config();
const SSLCommerz = require('sslcommerz-lts');
const User = require('../models/user');                 // your User model
const TeacherRequest = require('../models/teacherRequest');
const Payment = require('../models/payment');
const {
  TOPIC_PACK_PRICE, TOPIC_PACK_CREDITS
} = require('../config/billing');

const is_live = String(process.env.SSLCZ_LIVE).toLowerCase() === 'true';
const store_id = process.env.SSLCZ_STORE_ID;
const store_passwd = process.env.SSLCZ_STORE_PASSWD;

const attempts = global.__paymentAttempts || new Map();
global.__paymentAttempts = attempts;

const baseUrl = () =>
  process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

// small helper to append query params to a given URL
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

// ====================== Topic Pack (৳400 → 10 credits) ======================
exports.initiate = async (req, res) => {
  try {
    const type = String(req.body.type || 'TOPIC_PACK_10');
    const studentId = req.body.studentId; // REQUIRED to persist credits
    const returnUrl = req.body.returnUrl; // 👈 new (optional)
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

      // 👇 put the return target in value_a, and full meta in value_b
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
    // You pass requestId (approved), monthlyFee, phase, fraction (0.5/1 for FIRST), monthIndex
    const { requestId, monthlyFee, phase = 'FIRST', fraction, monthIndex = 1, returnUrl } = req.body;
    if (!requestId) return res.status(400).json({ error: 'requestId is required' });

    const reqDoc = await TeacherRequest.findById(requestId).select('studentId teacherId status');
    if (!reqDoc)   return res.status(404).json({ error: 'TeacherRequest not found' });
    if (reqDoc.status !== 'approved') {
      return res.status(400).json({ error: 'Request must be approved before payment' });
    }

    const fee = Number(monthlyFee);
    if (!fee || fee <= 0) return res.status(400).json({ error: 'monthlyFee must be positive' });

    const f = phase === 'FIRST' && Number(fraction) === 0.5 ? 0.5 : 1;
    const amountNum = phase === 'FIRST' ? fee * f : fee;
    const amount = amountNum.toFixed(2);

    const orderId = `TUITION-${requestId}-${Date.now()}`;
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

      // 👇 carry the returnUrl and detailed meta
      value_a: returnUrl || req.headers.referer || '',
      value_b: JSON.stringify({
        type: 'TUITION',
        requestId, monthlyFee: fee, phase, fraction: f, monthIndex,
        studentId: reqDoc.studentId, teacherId: reqDoc.teacherId, amount: Number(amount)
      })
    };

    const sslcz = new SSLCommerz(store_id, store_passwd, is_live);
    const apiRes = await sslcz.init(data);
    if (!apiRes?.GatewayPageURL) return res.status(500).json({ error: 'GatewayPageURL missing', apiRes });

    attempts.set(tran_id, {
      type: 'TUITION',
      amount: Number(amount),
      monthlyFee: fee,
      phase, fraction: f, monthIndex: Number(monthIndex),
      requestId,
      studentId: reqDoc.studentId,
      teacherId: reqDoc.teacherId,
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

    // -------- Topic Pack: credit + persist payment ----------
    if (meta?.type === 'TOPIC_PACK_10') {
      await User.updateOne(
        { _id: meta.studentId },
        { $inc: { topicCredits: TOPIC_PACK_CREDITS } }
      );
      await Payment.create({
        type: 'TOPIC_PACK',
        studentId: meta.studentId,
        amount: meta.amount,
        tran_id,
        bank_tran_id: v.bank_tran_id,
        status: 'PAID'
      });
      attempts.delete(tran_id);

      // 👇 redirect back if we have a return target
      if (value_a) {
        const back = appendQuery(value_a, {
          paid: 1, type: meta.type || 'PAYMENT', tran_id, amt: meta.amount
        });
        return res.redirect(302, back);
      }

      return res.status(200).send(`
        <h2>✅ Topic Pack Purchased</h2>
        <pre>${JSON.stringify({
          studentId: meta.studentId,
          creditsAdded: TOPIC_PACK_CREDITS,
          amount: meta.amount
        }, null, 2)}</pre>
      `);
    }

    // -------- Tuition: compute split + persist payment ------
    if (meta?.type === 'TUITION') {
      const rate = tuitionRate(meta.phase, meta.monthIndex);   // 0.30 or 0.15
      const yourShare  = +(meta.amount * rate).toFixed(2);
      const teacherNet = +(meta.amount - yourShare).toFixed(2);

      await Payment.create({
        type: 'TUITION',
        requestId: meta.requestId,
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

      attempts.delete(tran_id);

      if (value_a) {
        const back = appendQuery(value_a, {
          paid: 1, type: meta.type || 'PAYMENT', tran_id, amt: meta.amount,
          phase: meta.phase, month: meta.monthIndex
        });
        return res.redirect(302, back);
      }

      return res.status(200).send(`
        <h2>✅ Tuition Payment Success</h2>
        <pre>${JSON.stringify({
          requestId: meta.requestId,
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

    // Fallback
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
      const back = appendQuery(value_a, {
        paid: 0, status: 'fail', type: meta?.type || 'PAYMENT', tran_id: tran_id || ''
      });
      return res.redirect(302, back);
    }
    return res.status(200).send('<h2>❌ Payment Failed</h2>');
  } catch (e) {
    return res.status(200).send('<h2>❌ Payment Failed</h2>');
  }
};

exports.cancel = async (req, res) => {
  try {
    const { tran_id, value_a } = req.body || {};
    attempts.delete(tran_id);
    if (value_a) {
      const meta = safeParseMeta(req.body?.value_b);
      const back = appendQuery(value_a, {
        paid: 0, status: 'cancel', type: meta?.type || 'PAYMENT', tran_id: tran_id || ''
      });
      return res.redirect(302, back);
    }
    return res.status(200).send('<h2>🛑 Payment Cancelled</h2>');
  } catch (e) {
    return res.status(200).send('<h2>🛑 Payment Cancelled</h2>');
  }
};

exports.ipn = async (req, res) => {
  try {
    // Optionally: repeat the same validation here using req.body.val_id and upsert Payment (idempotent)
    res.status(200).end();
  } catch {
    res.status(200).end();
  }
};

function safeParseMeta(s) {
  try { return s ? JSON.parse(s) : null; } catch { return null; }
}
