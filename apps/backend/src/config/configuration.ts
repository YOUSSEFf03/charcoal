/**
 * Typed configuration object.
 *
 * Registered as the `load` function in ConfigModule.forRoot. Values are read
 * from process.env *after* Joi validation has run (and applied defaults), so
 * this maps the validated environment into a strongly typed shape that the
 * rest of the app reads via ConfigService.get<...>('key').
 */
export interface AppConfig {
  nodeEnv: string;
  port: number;
  database: {
    url: string;
  };
  clerk: {
    secretKey: string;
    webhookSecret: string;
    jwksUrl: string;
    publishableKey?: string;
  };
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3001', 10),
  database: {
    url: process.env.DATABASE_URL as string,
  },
  clerk: {
    secretKey: process.env.CLERK_SECRET_KEY as string,
    webhookSecret: process.env.CLERK_WEBHOOK_SECRET as string,
    jwksUrl:
      process.env.CLERK_JWKS_URL ?? 'https://api.clerk.com/v1/jwks',
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  },
});
