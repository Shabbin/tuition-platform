module.exports = {
  TOPIC_PACK_PRICE:  Number(process.env.TOPIC_PACK_PRICE  || 400),  // ৳400
  TOPIC_PACK_CREDITS:Number(process.env.TOPIC_PACK_CREDITS|| 10),   // 10 credits
  PER_SOLVE_GROSS:   Number(process.env.PER_SOLVE_GROSS   || 40),   // ৳40 per solve
  PLATFORM_FEE_RATE: Number(process.env.PLATFORM_FEE_RATE || 0.10), // 10% of 40
};