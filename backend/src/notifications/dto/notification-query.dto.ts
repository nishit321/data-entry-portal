import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class NotificationQueryDto extends PaginationQueryDto {
  /**
   * Kept as a string ('true'/'false') and coerced in the service. A boolean here would be mangled
   * by the global ValidationPipe's implicit conversion (Boolean('false') === true).
   */
  @IsOptional()
  @IsIn(['true', 'false'])
  unreadOnly?: 'true' | 'false';
}
