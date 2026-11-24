import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { UserChangePasswordDto } from './user-change-password.dto';

// Same options as main.ts: unknown properties are rejected with HTTP 400.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const validate = (body: unknown) => pipe.transform(body, { type: 'body', metatype: UserChangePasswordDto });

describe('change-password request body', () => {
  it('accepts exactly currentPassword and newPassword', async () => {
    await expect(validate({ currentPassword: 'old123', newPassword: 'new12345' })).resolves.toBeDefined();
  });

  it('rejects the confirmation field, so clients must not send it (A4)', async () => {
    await expect(validate({ currentPassword: 'old123', newPassword: 'new12345', confirmPassword: 'new12345' }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('rejects a new password shorter than 6 characters', async () => {
    await expect(validate({ currentPassword: 'old123', newPassword: '123' })).rejects.toMatchObject({ status: 400 });
  });
});
