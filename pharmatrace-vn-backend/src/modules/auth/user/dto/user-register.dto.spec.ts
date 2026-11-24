import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { UserRegisterDto } from './user-register.dto';

// Same options as main.ts.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const base = { name: 'Test Customer', email: 'test@example.com', password: 'secret123' };
const register = (phone: unknown) => pipe.transform({ ...base, phone }, { type: 'body', metatype: UserRegisterDto }) as Promise<UserRegisterDto>;

describe('registration phone number (A3)', () => {
  it('rejects the reported trailing backtick and other junk with HTTP 400', async () => {
    for (const phone of ['012345678`', 'abcdefghij', '0909 12 34', '']) {
      await expect(register(phone)).rejects.toMatchObject({ status: 400 });
    }
  });

  it('stores valid numbers in the normalised local form', async () => {
    await expect(register('0909 123 456')).resolves.toMatchObject({ phone: '0909123456' });
    await expect(register('+84909123456')).resolves.toMatchObject({ phone: '0909123456' });
  });
});
