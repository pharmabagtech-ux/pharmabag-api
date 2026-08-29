import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateBlogPostDto } from './create-blog-post.dto';

/**
 * `BlogPost.categoryId` is nullable in the Prisma schema and the one live post
 * carries null — but the DTO required it, so the admin UI could never create
 * an uncategorised post. authorId stays required (posts need attribution).
 */
describe('CreateBlogPostDto', () => {
  const base = {
    title: 'What is PTR pricing?',
    content: '<p>PTR is…</p>',
    authorId: '55c94c35-dee6-4b0f-8873-a51508e7c62e',
  };

  it('accepts a post with NO categoryId', async () => {
    const dto = plainToInstance(CreateBlogPostDto, base);
    const errors = await validate(dto);
    expect(errors.filter((e) => e.property === 'categoryId')).toHaveLength(0);
  });

  it('still rejects a non-UUID categoryId when one IS supplied', async () => {
    const dto = plainToInstance(CreateBlogPostDto, {
      ...base,
      categoryId: 'not-a-uuid',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'categoryId')).toBe(true);
  });

  it('still requires authorId', async () => {
    const { authorId: _omitted, ...noAuthor } = base;
    const dto = plainToInstance(CreateBlogPostDto, noAuthor);
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'authorId')).toBe(true);
  });
});
