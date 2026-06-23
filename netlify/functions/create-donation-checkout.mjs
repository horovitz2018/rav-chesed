import { getStripe, getSiteUrl } from './_settings.mjs';

// יוצר Stripe Checkout Session עבור תרומה חד-פעמית ומחזיר את כתובת התשלום.
// מפתח Stripe נטען ממשתני סביבה (STRIPE_SECRET_KEY) — לא מהדאטהבייס.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { stripe } = getStripe();
    if (!stripe) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Stripe טרם הוגדר (חסר STRIPE_SECRET_KEY במשתני הסביבה).' }) };
    }

    const { amount, donorId, campaignId, donorName, email } = JSON.parse(event.body || '{}');
    const cents = Math.round(Number(amount) * 100);
    if (!cents || cents < 100) {
      return { statusCode: 400, body: JSON.stringify({ error: 'סכום לא תקין (מינימום 1€)' }) };
    }
    const origin = getSiteUrl(event);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          unit_amount: cents,
          product_data: { name: 'תרומה לרב חסד' },
        },
        quantity: 1,
      }],
      customer_email: email || undefined,
      metadata: {
        donorId: donorId || '',
        campaignId: campaignId || '',
        donorName: donorName || '',
      },
      success_url: `${origin}/?donation=success`,
      cancel_url: `${origin}/?donation=cancel`,
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
