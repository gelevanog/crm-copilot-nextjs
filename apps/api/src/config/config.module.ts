import { Global, Inject, Module } from '@nestjs/common';
import { loadEnv, type Env } from './env';

export const ENV = Symbol('ENV');

/** Parameter decorator for injecting the validated environment. */
export const InjectEnv = () => Inject(ENV);

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => loadEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
