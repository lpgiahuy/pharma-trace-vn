import { Body, Controller, HttpException, HttpStatus, Ip, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChatbotService } from './chatbot.service';
import { AskChatbotDto } from './dto/chat.dto';
import { hasRedFlag } from './red-flags';
import { SlidingWindowLimiter } from './rate-limiter';

@ApiTags('Chatbot')
@Controller('chatbot')
export class ChatbotController {
  private readonly perMinute = new SlidingWindowLimiter(8, 60_000);
  private readonly perHour = new SlidingWindowLimiter(60, 60 * 60_000);

  constructor(private readonly chatbot: ChatbotService) {}

  @Post('ask')
  @ApiOperation({
    summary: 'Ask the medicine assistant (Public)',
    description:
      'RAG over the active catalogue with Gemini: describe a symptom or condition and get grounded product suggestions. ' +
      'Stateless: the client sends the previous turns in `history`. Emergency wording short-circuits to a fixed 115 message.',
  })
  async ask(@Body() dto: AskChatbotDto, @Ip() ip: string) {
    // Emergency wording is answered from a fixed text (no Gemini call), so it is never throttled.
    const emergency = hasRedFlag(dto.message);
    if (!emergency && (!this.perMinute.tryConsume(ip) || !this.perHour.tryConsume(ip))) {
      throw new HttpException('You are asking too quickly. Please try again in a few minutes.', HttpStatus.TOO_MANY_REQUESTS);
    }
    return { success: true, data: await this.chatbot.ask(dto) };
  }
}
