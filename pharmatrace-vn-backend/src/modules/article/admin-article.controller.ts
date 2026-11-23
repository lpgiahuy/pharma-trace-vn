import {
  BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ArticleService } from './article.service';
import { ArticleCommentService } from './article-comment.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { ArticleQueryDto, CommentQueryDto } from './dto/article-query.dto';
import { ReviewArticleDto, SaveArticleDto, SaveCategoryDto } from './dto/save-article.dto';
import { CommentDto, CommentStatusDto } from './dto/comment.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('Admin - Blog')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN', 'PHARMACIST')
@Controller('admin')
export class AdminArticleController {
  constructor(
    private readonly articles: ArticleService,
    private readonly comments: ArticleCommentService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  @Get('articles')
  @ApiOperation({ summary: 'List articles (Admin sees all, pharmacist sees own)' })
  async list(@Query() query: ArticleQueryDto, @CurrentUser() user: CurrentUserPayload) {
    const { items, pagination } = await this.articles.listForStaff(query, user);
    return { success: true, data: items, pagination };
  }

  @Post('articles/upload-image')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload an article image' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) =>
        /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)
          ? cb(null, true)
          : cb(new BadRequestException('Only jpg, png, webp or gif images are allowed'), false),
    }),
  )
  async uploadImage(@UploadedFile() file: { buffer: Buffer; mimetype: string } | undefined) {
    if (!file) throw new BadRequestException('Please provide an image file');
    const uploaded = await this.cloudinary.uploadImage(file, 'pharmatrace/articles');
    return { success: true, data: { imageUrl: uploaded.secure_url, publicId: uploaded.public_id } };
  }

  @Get('articles/:id')
  @ApiOperation({ summary: 'Get an article for editing' })
  async detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.articles.getForStaff(id, user) };
  }

  @Post('articles')
  @ApiOperation({ summary: 'Create an article' })
  async create(@Body() dto: SaveArticleDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.articles.create(dto, user) };
  }

  @Put('articles/:id')
  @ApiOperation({ summary: 'Update an article' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveArticleDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return { success: true, data: await this.articles.update(id, dto, user) };
  }

  @Patch('articles/:id/review')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Approve, hide or send back an article (Admin)' })
  async review(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewArticleDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return { success: true, data: await this.articles.review(id, dto, user) };
  }

  @Delete('articles/:id')
  @ApiOperation({ summary: 'Delete an article' })
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.articles.remove(id, user) };
  }

  @Post('article-categories')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Create a category (Admin)' })
  async createCategory(@Body() dto: SaveCategoryDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.articles.createCategory(dto, user) };
  }

  @Put('article-categories/:id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Rename a category (Admin)' })
  async updateCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveCategoryDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return { success: true, data: await this.articles.updateCategory(id, dto, user) };
  }

  @Delete('article-categories/:id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Delete a category (Admin)' })
  async removeCategory(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.articles.removeCategory(id, user) };
  }

  @Get('article-comments')
  @ApiOperation({ summary: 'List comments across articles' })
  async listComments(@Query() query: CommentQueryDto, @CurrentUser() user: CurrentUserPayload) {
    const { items, pagination } = await this.comments.listForStaff(query, user);
    return { success: true, data: items, pagination };
  }

  @Post('article-comments/:id/reply')
  @ApiOperation({ summary: 'Reply to a comment (Admin / Pharmacist)' })
  async reply(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CommentDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return { success: true, data: await this.comments.reply(id, dto, user) };
  }

  @Patch('article-comments/:id/status')
  @ApiOperation({ summary: 'Hide or show a comment' })
  async setStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CommentStatusDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return { success: true, data: await this.comments.setStatus(id, dto, user) };
  }

  @Delete('article-comments/:id')
  @ApiOperation({ summary: 'Delete a comment (Admin, or pharmacist own reply)' })
  async removeComment(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.comments.remove(id, user) };
  }
}
