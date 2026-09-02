import { Module } from '@nestjs/common';
import { FeedsController } from './feeds.controller';
import { FeedsService } from './feeds.service';
import { FeedFetcher } from './feed-fetcher';

/**
 * Automated metric feeds under data-sharing agreements (Q10, Phase 3). Exported so the scheduler
 * can run the hourly pull.
 */
@Module({
  controllers: [FeedsController],
  providers: [FeedsService, FeedFetcher],
  exports: [FeedsService],
})
export class FeedsModule {}
