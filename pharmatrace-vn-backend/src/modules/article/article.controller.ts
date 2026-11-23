import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArticleService } from './article.service';
import { ArticleCommentService } from './article-comment.service';
import { ArticleQueryDto } from './dto/article-query.dto';
import { CommentDto } from './dto/comment.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('Blog')
@Controller()
export class ArticleController {
  constructor(
    private readonly articles: ArticleService,
    private readonly comments: ArticleCommentService,
  ) {}

  @Get('articles')
  @ApiOperation({ summary: 'List published articles (Public)' })
  async list(@Query() query: ArticleQueryDto) {
    const { items, pagination } = await this.articles.listPublished(query);
    return { success: true, data: items, pagination };
  }

  @Get('articles/categories')
  @ApiOperation({ summary: 'List article categories (Public)' })
  async categories() {
    return { success: true, data: await this.articles.listCategories() };
  }

  @Get('articles/:slug')
  @ApiOperation({ summary: 'Read a published article (Public)' })
  async detail(@Param('slug') slug: string) {
    return { success: true, data: await this.articles.getPublishedBySlug(slug) };
  }

  @Get('articles/:slug/comments')
  @ApiOperation({ summary: 'List comments with staff replies (Public)' })
  async listComments(@Param('slug') slug: string, @Query() query: ArticleQueryDto) {
    const { items, pagination } = await this.comments.listByArticle(slug, query);
    return { success: true, data: items, pagination };
  }

  @Post('articles/:slug/comments')
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiOperation({ summary: 'Comment on an article (Customer)' })
  async comment(@Param('slug') slug: string, @Body() dto: CommentDto, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.comments.create(slug, dto, user) };
  }

  @Patch('customer/article-comments/:id')
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiOperation({ summary: 'Edit own comment (Customer)' })
  async editComment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CommentDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return { success: true, data: await this.comments.updateOwn(id, dto, user) };
  }

  @Delete('customer/article-comments/:id')
  @HttpCode(200)
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiOperation({ summary: 'Delete own comment (Customer)' })
  async deleteComment(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return { success: true, data: await this.comments.remove(id, user) };
  }
}
