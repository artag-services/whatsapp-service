/**
 * Typed shapes for inbound Meta WhatsApp Cloud API webhook payloads, plus
 * the API response shapes used by `MetaApiClient`. Replaces the old `as any`
 * casts scattered across the listener.
 *
 * Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
 */

// ─── Webhook envelope ───
export interface MetaWebhookPayload {
  entry?: MetaWebhookEntry[]
  value?: MetaWebhookValue
}

export interface MetaWebhookEntry {
  id: string
  changes: Array<{ field: string; value: MetaWebhookValue }>
}

export interface MetaWebhookValue {
  messaging_product?: 'whatsapp'
  metadata?: { display_phone_number: string; phone_number_id: string }
  contacts?: MetaWebhookContact[]
  messages?: MetaIncomingMessage[]
  statuses?: MetaMessageStatus[]
  users?: MetaPhoneNumberUpdate[]
}

export interface MetaWebhookContact {
  wa_id: string
  profile?: { name?: string }
}

export interface MetaIncomingMessage {
  from: string
  id: string
  timestamp: string
  type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'location' | 'contacts' | 'interactive' | string
  text?: { body: string }
  image?: { id: string; mime_type: string; sha256: string; caption?: string }
  // ...other media types omitted for brevity
}

export interface MetaMessageStatus {
  id: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  timestamp: string
  recipient_id: string
  errors?: Array<{ code: number; title: string; message?: string }>
}

export interface MetaPhoneNumberUpdate {
  old_phone: string
  new_phone: string
  user_id: string
}

// ─── Meta REST API ───
export interface MetaSendResponse {
  messaging_product: 'whatsapp'
  contacts: Array<{ input: string; wa_id: string }>
  messages: Array<{ id: string }>
}

export interface MetaApiError {
  error: {
    message: string
    type?: string
    code: number
    error_subcode?: number
    fbtrace_id?: string
  }
}

/** Meta error codes worth treating specially */
export const META_ERROR_CODES = {
  RE_ENGAGEMENT_REQUIRED: 131047, // 24h window expired, must use template
} as const
