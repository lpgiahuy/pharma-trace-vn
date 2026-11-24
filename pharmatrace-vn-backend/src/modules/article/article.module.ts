import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ArticleController } from './article.controller';
import { AdminArticleController } from './admin-article.controller';
import { ArticleService } from './article.service';
import { ArticleCommentService } from './article-comment.service';

@Module({
  imports: [PrismaModule],
  controllers: [ArticleController, AdminArticleController],
  providers: [ArticleService, ArticleCommentService],
})
export class ArticleModule {}
