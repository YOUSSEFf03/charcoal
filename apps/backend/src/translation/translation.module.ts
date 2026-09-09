import { Module } from '@nestjs/common';
import { TranslationController } from './translation.controller';
import { TranslationService } from './translation.service';
import { GoogleTranslateProvider } from './google-translate.provider';
import { TRANSLATION_PROVIDER } from './translation.provider';

@Module({
  controllers: [TranslationController],
  providers: [
    TranslationService,
    GoogleTranslateProvider,
    { provide: TRANSLATION_PROVIDER, useExisting: GoogleTranslateProvider },
  ],
})
export class TranslationModule {}
