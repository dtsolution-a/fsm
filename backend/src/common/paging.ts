import { IsBooleanString, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number = 25;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsBooleanString() active?: string; // 'true' | 'false'
}

export const pageArgs = (q: PageQuery) => {
  const page = q.page || 1;
  const limit = q.limit || 25;
  return { page, limit, skip: (page - 1) * limit, take: limit };
};

export const paged = <T>(data: T[], total: number, page: number, limit: number) => ({
  data,
  meta: { page, limit, total, pages: Math.ceil(total / limit) },
});

// Today's calendar date in India (business timezone), as YYYY-MM-DD
export const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
export const dateOnly = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
