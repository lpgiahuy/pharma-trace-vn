import { Body, Controller, Get, Headers, Ip, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ScanBoxDto, VerifyBoxDto } from './dto/trace.dto';
import { TraceService } from './trace.service';

@ApiTags('Trace')
@Controller('trace')
export class TraceController {
  constructor(private readonly trace: TraceService) {}

  @Post('verify')
  @ApiOperation({ summary: 'Check the secret code of a box (HMAC SHA-256). The first valid entry activates the box; later ones report the original activation; 10 valid entries in a minute flag the box as counterfeit' })
  async verify(@Body() dto: VerifyBoxDto, @Ip() ip: string) {
    return { success: true, data: await this.trace.verify(dto, ip) };
  }

  @Post('scan')
  @ApiOperation({ summary: 'Log a public QR scan; a box scanned 10 times in a minute or in two places too far apart is flagged as counterfeit' })
  async scan(@Body() dto: ScanBoxDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string) {
    return { success: true, data: await this.trace.scan(dto, ip, userAgent) };
  }

  @Get(':uid')
  @ApiOperation({ summary: 'Public box summary and trace timeline' })
  async history(@Param('uid', ParseUUIDPipe) uid: string) {
    return { success: true, data: await this.trace.history(uid) };
  }
}
