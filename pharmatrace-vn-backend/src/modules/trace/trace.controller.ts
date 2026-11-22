import { Body, Controller, Get, Headers, Ip, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ScanBoxDto, VerifyBoxDto } from './dto/trace.dto';
import { TraceService } from './trace.service';

@ApiTags('Trace')
@Controller('trace')
export class TraceController {
  constructor(private readonly trace: TraceService) {}

  @Post('verify')
  @ApiOperation({ summary: 'Check the secret code printed with a box QR code (HMAC SHA-256)' })
  async verify(@Body() dto: VerifyBoxDto) {
    return { success: true, data: await this.trace.verify(dto) };
  }

  @Post('scan')
  @ApiOperation({ summary: 'Log a public QR scan and flag impossible travel speed or excessive rescans' })
  async scan(@Body() dto: ScanBoxDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string) {
    return { success: true, data: await this.trace.scan(dto, ip, userAgent) };
  }

  @Get(':uid')
  @ApiOperation({ summary: 'Public box summary and trace timeline' })
  async history(@Param('uid', ParseUUIDPipe) uid: string) {
    return { success: true, data: await this.trace.history(uid) };
  }
}
