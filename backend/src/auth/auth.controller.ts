import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { IsString, MinLength } from 'class-validator';
import { IsStrongPassword } from '../common/password';
import { AuthService } from './auth.service';
import { Auth, CurrentUser } from './guards';
import { AuthUser } from './jwt.strategy';

class LoginDto {
  @IsString() identifier: string;
  @IsString() @MinLength(1) password: string;
}
class ChangePasswordDto {
  @IsString() currentPassword: string;
  @IsString() @IsStrongPassword() newPassword: string;
}
class TokenDto {
  @IsString() refreshToken: string;
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('login')
  @UseGuards(ThrottlerGuard)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.identifier, dto.password);
  }

  @Post('refresh')
  @UseGuards(ThrottlerGuard)
  refresh(@Body() dto: TokenDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  logout(@Body() dto: TokenDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @Post('change-password')
  @Auth()
  @UseGuards(ThrottlerGuard)
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }

  @Get('me')
  @Auth()
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}
