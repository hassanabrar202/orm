import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createGraph, updateFirstGraph } from '../../src/mutation-graph/collection-graphs';
import { parseMutationInput } from '../../src/relation-mutations';
import type { RelationMutator } from '../../src/types';
import { createCollectionFor } from '../collection-fixtures';
import { getTestContext } from '../helpers';
import { printGraph } from './print-graph';

type Mutator = RelationMutator<Contract<SqlStorage>, string>;

const ada = { id: 1, name: 'Ada', email: 'ada@example.com' };
const hello = { id: 10, title: 'Hello', views: 0 };

function parsed(modelName: 'User' | 'Post', input: Record<string, unknown>) {
  return parseMutationInput(getTestContext().contract, 'public', modelName, input as never);
}

function printCreate(modelName: 'User' | 'Post', input: Record<string, unknown>): string {
  const target = {
    context: getTestContext(),
    state: createCollectionFor(modelName).collection.state,
    modelName,
    namespaceId: 'public',
  };
  return printGraph(createGraph(target, parsed(modelName, input)));
}

function printUpdate(modelName: 'User' | 'Post', input: Record<string, unknown>): string {
  const target = {
    context: getTestContext(),
    state: createCollectionFor(modelName).collection.where({ id: 1 }).state,
    modelName,
    namespaceId: 'public',
  };
  return printGraph(updateFirstGraph(target, {}, parsed(modelName, input).relationMutations));
}

describe('a relation callback that returns an array of operations', () => {
  it('in update() adds the operations on a relation the child holds the key for in array order', () => {
    expect(
      printUpdate('User', {
        posts: (posts: Mutator) => [
          posts.create([hello]),
          posts.connect({ id: 11 }),
          posts.disconnect([{ id: 12 }]),
        ],
      }),
    ).toBe(
      [
        'n1 Find users where id = 1 limit 1',
        'n2 Insert posts <- PayloadData n1 (id->user_id)',
        'n3 Update posts set nothing where id = 11 <- PayloadData n1 (id->user_id)',
        'n4 Update posts set user_id = null where id = 12 <- FilterData n1 (id->user_id)',
        'result: n1',
      ].join('\n'),
    );
  });

  it('in create() adds the create and connect operations in array order', () => {
    expect(
      printCreate('User', {
        ...ada,
        posts: (posts: Mutator) => [posts.create([hello]), posts.connect({ id: 11 })],
      }),
    ).toBe(
      [
        'n1 Insert users',
        'n2 Insert posts <- PayloadData n1 (id->user_id)',
        'n3 Update posts set nothing where id = 11 <- PayloadData n1 (id->user_id)',
        'result: n1',
      ].join('\n'),
    );
  });

  it('in update() adds the operations on a many-to-many relation in array order', () => {
    expect(
      printUpdate('User', {
        tags: (tags: Mutator) => [
          tags.disconnect([{ name: 'SQL' }]),
          tags.connect({ name: 'Go' }),
          tags.create([{ id: 't1', name: 'Rust' }]),
        ],
      }),
    ).toBe(
      [
        'n1 Find users where id = 1 limit 1',
        "n2 Find tags where name = 'SQL' limit 1 <- Requires n1",
        'n3 Assert <- Rows n2, Requires n1',
        'n4 Delete user_tags <- FilterData n1 (id->user_id), FilterData n2 (id->tag_id)',
        "n5 Find tags where name = 'Go' limit 1 <- Requires n1",
        'n6 Assert <- Rows n5, Requires n1',
        'n7 Insert user_tags on conflict (user_id, tag_id) do nothing <- PayloadData n1 (id->user_id), PayloadData n5 (id->tag_id)',
        'n8 Insert tags <- Requires n1',
        'n9 Insert user_tags <- PayloadData n1 (id->user_id), PayloadData n8 (id->tag_id)',
        'result: n1',
      ].join('\n'),
    );
  });

  it('on a relation the parent holds the key for runs every operation, and the last one sets the key', () => {
    expect(
      printCreate('Post', {
        ...hello,
        author: (author: Mutator) => [author.connect({ id: 1 }), author.connect({ id: 2 })],
      }),
    ).toBe(
      [
        'n1 Find users where id = 1 limit 1',
        'n2 Assert <- Rows n1',
        'n3 Find users where id = 2 limit 1',
        'n4 Assert <- Rows n3',
        'n5 Insert posts <- PayloadData n3 (id->user_id)',
        'result: n5',
      ].join('\n'),
    );
  });

  it('adds nothing for an empty array', () => {
    expect({
      update: printUpdate('User', { posts: () => [] }),
      create: printCreate('User', { ...ada, posts: () => [], tags: () => [] }),
    }).toEqual({
      update: ['n1 Find users where id = 1 limit 1', 'result: n1'].join('\n'),
      create: ['n1 Insert users', 'result: n1'].join('\n'),
    });
  });

  it.each([
    [
      'a nested array',
      (posts: Mutator) => [posts.connect({ id: 11 }), [posts.disconnect()]],
      {
        message:
          'Relation field "posts" on model "User" returned a nested array at index 1; return one flat array of mutations',
        meta: { relation: 'posts', model: 'User', problem: 'nested-array', index: 1 },
      },
    ],
    [
      'an element that is not an operation',
      (posts: Mutator) => [posts.connect({ id: 11 }), { id: 12 }],
      {
        message:
          'Relation field "posts" on model "User" returned an invalid mutation descriptor at index 1',
        meta: { relation: 'posts', model: 'User', problem: 'invalid-descriptor', index: 1 },
      },
    ],
  ])('rejects %s before the graph is built', (_, posts, rejection) => {
    expect(() => parsed('User', { posts })).toThrow(
      expect.objectContaining({ code: 'ORM.RELATION_MUTATION_INVALID', ...rejection }),
    );
  });

  it('rejects a disconnect inside an array in create()', () => {
    expect(() =>
      printCreate('User', {
        ...ada,
        posts: (posts: Mutator) => [posts.connect({ id: 11 }), posts.disconnect([{ id: 12 }])],
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
        message: 'disconnect() is only supported in update() nested mutations',
        meta: { kind: 'disconnect', relation: 'posts' },
      }),
    );
  });
});
