import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { GeminiClient } from './gemini.client';
import { MedicineIndexService } from './medicine-index.service';

@Module({
  imports: [PrismaModule],
  controllers: [ChatbotController],
  providers: [ChatbotService, GeminiClient, MedicineIndexService],
})
export class ChatbotModule {}
