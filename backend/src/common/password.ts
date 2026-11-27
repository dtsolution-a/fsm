import { Matches, MinLength, MaxLength } from 'class-validator';
import { applyDecorators } from '@nestjs/common';

/** At least 10 characters with a letter and a digit. Also used when an admin sets or resets a password. */
export const PASSWORD_RULE = 'Password must be at least 10 characters and contain a letter and a number';
export const IsStrongPassword = () =>
  applyDecorators(MinLength(10, { message: PASSWORD_RULE }), MaxLength(128), Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: PASSWORD_RULE }));
