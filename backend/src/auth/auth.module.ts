import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { PhoneVerificationService } from './phone-verification.service';
import { TotpService } from './totp.service';
import { JwtConfig } from '../config/configuration';

@Module({
  imports: [
    SettingsModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const jwt = config.get<JwtConfig>('jwt')!;
        /*
         * No `expiresIn` here.
         *
         * Every token is signed with a lifetime worked out from the idle timeout the Authority
         * has set, so a default at this level could only ever be a second answer to the same
         * question - and the wrong one on any server where somebody had changed the setting.
         */
        return { secret: jwt.secret };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, PhoneVerificationService, TotpService],
  // The users module needs it: an administrator resetting somebody else's authenticator app is a
  // user-administration action, and the logic that knows what a second factor is lives here.
  exports: [TotpService],
})
export class AuthModule {}
