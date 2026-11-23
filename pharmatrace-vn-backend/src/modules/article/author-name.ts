import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';

export function authorName(user: CurrentUserPayload): string {
  return typeof user.fullName === 'string' ? user.fullName : '';
}
