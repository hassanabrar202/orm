import { expectTypeOf, test } from 'vitest';
import type { MutationCreateInput, MutationUpdateInput } from '../src/types';
import type { Contract } from './fixtures/generated/contract';

type UserCreate = MutationCreateInput<Contract, 'User'>;
type UserUpdate = MutationUpdateInput<Contract, 'User'>;
type TagCreate = MutationCreateInput<Contract, 'Tag'>;
type PostCreate = MutationCreateInput<Contract, 'Post'>;
type PostUpdate = MutationUpdateInput<Contract, 'Post'>;

const tagCriterion = { id: 'featured' } as { readonly id: NonNullable<TagCreate['id']> };

test('update input accepts an array of operations on a one-to-many relation', () => {
  const input: UserUpdate = {
    posts: (posts) => [
      posts.create({ id: 1, title: 'New', views: 0 }),
      posts.connect({ id: 2 }),
      posts.disconnect([{ id: 3 }]),
      posts.disconnect(),
    ],
  };

  expectTypeOf(input).toExtend<UserUpdate>();
});

test('create input accepts an array of create and connect operations', () => {
  const input: UserCreate = {
    name: 'Alice',
    email: 'alice@test.com',
    posts: (posts) => [posts.create({ id: 1, title: 'New', views: 0 }), posts.connect({ id: 2 })],
    tags: (tags) => [tags.connect(tagCriterion)],
  };

  expectTypeOf(input).toExtend<UserCreate>();
});

test('a readonly array and an empty array are accepted in both contexts', () => {
  const update: UserUpdate = {
    posts: (posts) => [posts.connect({ id: 2 }), posts.disconnect()] as const,
    tags: () => [],
  };
  const create: UserCreate = {
    name: 'Alice',
    email: 'alice@test.com',
    posts: (posts) => [posts.connect({ id: 2 })] as const,
    tags: () => [],
  };

  expectTypeOf(update).toExtend<UserUpdate>();
  expectTypeOf(create).toExtend<UserCreate>();
});

test('a nested array of operations is a type error', () => {
  const update: UserUpdate = {
    // @ts-expect-error
    posts: (posts) => [posts.connect({ id: 2 }), [posts.disconnect()]],
  };
  const create: UserCreate = {
    name: 'Alice',
    email: 'alice@test.com',
    // @ts-expect-error
    posts: (posts) => [[posts.connect({ id: 2 })]],
  };

  expectTypeOf(update).toExtend<UserUpdate>();
  expectTypeOf(create).toExtend<UserCreate>();
});

test('an array element that is not an operation is a type error', () => {
  const update: UserUpdate = {
    // @ts-expect-error
    posts: (posts) => [posts.connect({ id: 2 }), { id: 3 }],
  };
  const create: UserCreate = {
    name: 'Alice',
    email: 'alice@test.com',
    // @ts-expect-error
    posts: () => [null],
  };

  expectTypeOf(update).toExtend<UserUpdate>();
  expectTypeOf(create).toExtend<UserCreate>();
});

test('disconnect inside an array is a type error in create input on a one-to-many relation', () => {
  const input: UserCreate = {
    name: 'Alice',
    email: 'alice@test.com',
    posts: (posts) => [
      posts.connect({ id: 2 }),
      // @ts-expect-error
      posts.disconnect([{ id: 3 }]),
    ],
  };

  expectTypeOf(input).toExtend<UserCreate>();
});

test('a to-one relation takes a single operation or an array of at most one', () => {
  const post: PostUpdate = {
    author: (author) => [author.connect({ id: 1 })],
  };
  const user: UserUpdate = {
    profile: (profile) => profile.disconnect(),
    invitedBy: () => [],
  };

  expectTypeOf(post).toExtend<PostUpdate>();
  expectTypeOf(user).toExtend<UserUpdate>();
});

test('an array of two operations on a to-one relation is a type error', () => {
  const post: PostCreate = {
    id: 1,
    title: 'Hello',
    views: 0,
    // @ts-expect-error
    author: (author) => [author.connect({ id: 1 }), author.connect({ id: 2 })],
  };
  const user: UserUpdate = {
    // @ts-expect-error
    profile: (profile) => [profile.create({ id: 1, bio: 'a' }), profile.disconnect()],
  };

  expectTypeOf(post).toExtend<PostCreate>();
  expectTypeOf(user).toExtend<UserUpdate>();
});
