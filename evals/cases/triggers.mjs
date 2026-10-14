/*
 * Does the description route? Each prompt runs two turns with no browser: enough for the agent
 * to pick a skill, not to finish. A miss on either list means the description regressed.
 */

const SHOULD_TRIGGER = [
  ['mock-500', 'Use tweak to make GET /api/cart return a 500 error.'],
  ['stub-empty', 'I need a tweak rule that stubs /api/notifications with an empty list.'],
  ['fake-latency', 'Fake a slow response on /api/search with tweak, about 3 seconds.'],
  ['redirect-localhost', 'Reroute every call to api.example.com to my local server on localhost:5006 using tweak.'],
  ['images-placeholder', 'With the tweak extension, swap all product images for a placeholder image.'],
  ['simulate-401', 'Simulate the session expiring (401 on /api/me) with tweak so I can test the login redirect.'],
  ['import-file', 'Write me a tweak import file that mocks /graphql getUser with a user named Ada.'],
  ['local-script', 'Point the app.bundle.js script on staging.example.com at my local build, with tweak.'],
  ['modify-one-field', 'With tweak, keep the real /api/account response but make its "plan" field say "free".'],
  ['header-auth', 'Use tweak to add an Authorization: Bearer test-token header to every request to api.example.com.'],
  ['header-strip-csp', 'Strip the Content-Security-Policy header from staging.example.com pages using the tweak extension.'],
  ['edit-before-send', 'With tweak, pause the /api/checkout request so I can edit its body by hand before it is sent.'],
]

const SHOULD_NOT_TRIGGER = [
  ['tweak-verb-css', 'Tweak the padding on the .card class in styles.css so it is a bit tighter.'],
  ['vitest-mock', 'Show me how to mock fetch in a vitest unit test for a function that calls /api/cart.'],
  ['msw', 'Set up msw request handlers for /api/cart in my React app.'],
  ['nginx-redirect', 'Write an nginx config that redirects http to https.'],
  ['playwright-route', 'In my Playwright test, intercept /api/users and return an empty array.'],
  ['tweak-prompt', 'Can you tweak this sentence so it sounds friendlier: "Your request was denied."'],
  ['curl-debug', 'Why does curl https://api.example.com/cart return a 500 for me?'],
  ['express-mock-server', 'Create a tiny express server that serves fake JSON for /api/products.'],
  ['fetch-auth-header', 'How do I set an Authorization header on a fetch call in JavaScript?'],
  ['express-header-middleware', 'Write an Express middleware that adds an X-Request-Id header to every response.'],
  ['tweak-error-copy', 'Tweak the error response in my Express handler so the message says "Try again later".'],
  ['devtools-xhr-breakpoint', 'How do I set an XHR breakpoint in Chrome DevTools to pause on requests to /api/checkout?'],
]

const triggerCase =
  (expected) =>
  ([slug, prompt]) => ({
    id: `trigger-${expected ? 'yes' : 'no'}-${slug}`,
    mode: 'trigger',
    tags: ['trigger'],
    prompt,
    grade: (run, { check }) => {
      check(expected ? 'skill invoked' : 'skill not invoked', run.skillInvoked === expected)
    },
  })

export default [...SHOULD_TRIGGER.map(triggerCase(true)), ...SHOULD_NOT_TRIGGER.map(triggerCase(false))]
