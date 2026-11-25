// What visitors see before they ask anything. Edit these for your company.
export const SUPPORT_CHAT = {
  title: 'How can we help?',
  subtitle: 'Answers come from our own help content.',
  placeholder: 'Ask a question…',
  // Starter questions shown as buttons. Use questions your content answers.
  suggestions: [
    'What is your return policy?',
    'How long does shipping take?',
    'Do your products have a warranty?',
  ],
  // Show which model answered each message. Handy while you tune agent/lib/rules.ts;
  // turn it off before launch if you like.
  showModel: true,
} as const
