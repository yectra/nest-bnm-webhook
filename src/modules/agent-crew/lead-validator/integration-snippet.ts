/**
 * Example Integration Snippet for Fire-and-Forget background execution.
 *
 * Paste this inside your EventGridService or WebhookController when a new
 * lead event (e.g., POST_YOUR_REQUIREMENTS) is received.
 *
 * Important: Ensure LeadValidatorModule (or LeadValidatorService and its nodes)
 * are imported into the module where this is used.
 */

/*
// 1. Inject LeadValidatorService in the constructor:
// constructor(
//   private readonly leadValidatorService: LeadValidatorService
// ) {}

// 2. Inside the event handler:

const ticketId = event.data?.ticketId || event.id;
const userText = event.data?.description || '';
const mediaUrls = event.data?.attachments || [];
const declaredCategory = event.data?.category || 'Unknown';

// FIRE AND FORGET: Execute the validation pipeline asynchronously without `await`
// so the HTTP 200 response is not delayed.
Promise.resolve()
  .then(() => this.leadValidatorService.validateLead({
    ticketId,
    userText,
    mediaUrls,
    declaredCategory
  }))
  .catch((err) => {
    // The service itself handles errors, but this acts as a final safety net
    // for unhandled promise rejections.
    this.logger.error(`Background lead validation encountered an unhandled error: ${err.message}`);
  });

*/
