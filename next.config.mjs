/** @type {import('next').NextConfig} */
const config = {
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  poweredByHeader: false,
  devIndicators: false,
  serverExternalPackages: ['@cucumber/gherkin', '@cucumber/messages'],
  outputFileTracingExcludes: {
    '/*': ['./.fixture-lab/**/*', './.pagepilot/**/*', './.workbench/**/*', './outputs/**/*', './reports/**/*', './.cache/**/*', './.next-dev/**/*'],
  },
};
export default config;
