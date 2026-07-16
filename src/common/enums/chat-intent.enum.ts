export enum ChatIntent {
  // General Conversation
  GENERAL = 'general',
  GREETING = 'greeting',
  HELP = 'help',
  UNKNOWN = 'unknown',

  // Authentication & Account
  LOGIN = 'login',
  REGISTER = 'register',
  PROFILE = 'profile',
  ACCOUNT = 'account',

  // Service Discovery
  SERVICE = 'service',
  CATEGORY = 'category',
  SEARCH_SERVICE = 'search_service',

  // Quotes
  QUOTE = 'quote',
  CREATE_QUOTE = 'create_quote',
  QUOTE_STATUS = 'quote_status',
  QUOTE_HISTORY = 'quote_history',

  // Bookings
  BOOKING = 'booking',
  CREATE_BOOKING = 'create_booking',
  CANCEL_BOOKING = 'cancel_booking',
  RESCHEDULE_BOOKING = 'reschedule_booking',
  BOOKING_STATUS = 'booking_status',

  // Projects
  PROJECT = 'project',
  PROJECT_STATUS = 'project_status',
  PROJECT_PROGRESS = 'project_progress',
  PROJECT_TIMELINE = 'project_timeline',
  PROJECT_HISTORY = 'project_history',

  // Payments
  PAYMENT = 'payment',
  PAYMENT_STATUS = 'payment_status',
  PAYMENT_HISTORY = 'payment_history',
  INVOICE = 'invoice',

  // Service Provider
  PROVIDER = 'provider',
  PROVIDER_PROFILE = 'provider_profile',
  PROVIDER_AVAILABILITY = 'provider_availability',

  // Reviews
  REVIEW = 'review',
  RATING = 'rating',

  // Notifications
  NOTIFICATION = 'notification',

  // Support
  SUPPORT = 'support',
  COMPLAINT = 'complaint',
  TICKET = 'ticket',

  // Documents
  DOCUMENT = 'document',
  CONTRACT = 'contract',

  // Address
  ADDRESS = 'address',

  // Dashboard
  DASHBOARD = 'dashboard',

  // Analytics
  REPORT = 'report',

  // AI Knowledge
  FAQ = 'faq',
  POLICY = 'policy',

  // Escalation
  HUMAN_AGENT = 'human_agent',
}
