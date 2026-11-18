/** @type {import('next').NextConfig} */
const config = {
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  poweredByHeader: false,
  devIndicators: false,
  // Next.js 16 writes AGENTS.md and CLAUDE.md into the project on every dev start; this project keeps only README.md.
  agentRules: false,
  serverExternalPackages: ['@cucumber/gherkin', '@cucumber/messages'],
  outputFileTracingExcludes: {
    '/*': ['./.fixture-lab/**/*', './.pagepilot/**/*', './.workbench/**/*', './outputs/**/*', './reports/**/*', './.cache/**/*', './.next-dev/**/*', './.wordpress/**/*', './.drupal/**/*'],
  },
};
export default config;
