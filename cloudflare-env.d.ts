declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    // Optional WhatsApp integration (see .dev.vars.example and README).
    WHATSAPP_STORE_NUMBER?: string;
    WHATSAPP_TOKEN?: string;
    WHATSAPP_PHONE_NUMBER_ID?: string;
    WHATSAPP_ORDER_TEMPLATE?: string;
    WHATSAPP_UPDATE_TEMPLATE?: string;
    WHATSAPP_OFFER_TEMPLATE?: string;
    WHATSAPP_TEMPLATE_LANG?: string;
    /** Secret code to create the first owner account at /admin. */
    ADMIN_SETUP_CODE?: string;
    /** Optional: owner emails that are admins when signed in through the hosting platform. */
    ADMIN_EMAILS?: string;
    /** Optional: public shop address used in WhatsApp tracking links, e.g. https://farmtouch.in */
    SHOP_URL?: string;
  }
}
