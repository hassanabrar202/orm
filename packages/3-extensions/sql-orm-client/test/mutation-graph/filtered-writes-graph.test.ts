import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { BinaryExpr, ColumnRef, LiteralExpr } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createGraph, updateFirstGraph } from '../../src/mutation-graph/collection-graphs';
import { parseMutationInput } from '../../src/relation-mutations';
import type { RelationMutator } from '../../src/types';
import { createCollectionFor } from '../collection-fixtures';
import { getTestContext } from '../helpers';
import { printGraph } from './print-graph';

type Mutator = RelationMutator<Contract<SqlStorage>, string>;
type Context = ReturnType<typeof getTestContext>;

function parsed(context: Context, modelName: 'User' | 'Post', input: Record<string, unknown>) {
  return parseMutationInput(context.contract, 'public', modelName, input as never);
}

function printUpdate(
  input: Record<string, unknown>,
  modelName: 'User' | 'Post' = 'User',
  context: Context = getTestContext(),
): string {
  const target = {
    context,
    state: createCollectionFor(modelName).collection.where({ id: 1 }).state,
    modelName,
    namespaceId: 'public',
  };
  return printGraph(
    updateFirstGraph(target, {}, parsed(context, modelName, input).relationMutations),
  );
}

function printCreate(input: Record<string, unknown>): string {
  const context = getTestContext();
  const target = {
    context,
    state: createCollectionFor('User').collection.state,
    modelName: 'User',
    namespaceId: 'public',
  };
  return printGraph(createGraph(target, parsed(context, 'User', input)));
}

function graphOf(...writes: string[]): string {
  return ['n1 Find users where id = 1 limit 1', ...writes, 'result: n1'].join('\n');
}

const viewsAreSeven = BinaryExpr.eq(ColumnRef.of('posts', 'views'), LiteralExpr.of(7));

describe('updateAll and deleteAll on a one-to-many relation in update()', () => {
  it('updates the children of the parent that the filter matches', () => {
    expect(
      printUpdate({
        posts: (posts: Mutator) => posts.where({ title: 'Draft' }).updateAll({ views: 1 }),
      }),
    ).toBe(
      graphOf("n2 Update posts set views = 1 where title = 'Draft' <- FilterData n1 (id->user_id)"),
    );
  });

  it('deletes the children of the parent that the filter matches', () => {
    expect(
      printUpdate({
        posts: (posts: Mutator) => posts.where((post) => post['views']!.gt(10)).deleteAll(),
      }),
    ).toBe(graphOf('n2 Delete posts where views > 10 <- FilterData n1 (id->user_id)'));
  });

  it('updates and deletes every child of the parent without a where', () => {
    expect(
      printUpdate({
        posts: (posts: Mutator) => [posts.updateAll({ title: 'Published' }), posts.deleteAll()],
      }),
    ).toBe(
      graphOf(
        "n2 Update posts set title = 'Published' <- FilterData n1 (id->user_id)",
        'n3 Delete posts <- FilterData n1 (id->user_id)',
      ),
    );
  });

  it('combines chained where calls of every form with AND', () => {
    expect(
      printUpdate({
        posts: (posts: Mutator) =>
          posts
            .where({ title: 'Draft' })
            .where((post) => post['views']!.gt(10))
            .where(viewsAreSeven)
            .deleteAll(),
      }),
    ).toBe(
      graphOf(
        "n2 Delete posts where title = 'Draft' and views > 10 and views = 7 <- FilterData n1 (id->user_id)",
      ),
    );
  });

  it('adds no node for updateAll with no data', () => {
    expect(printUpdate({ posts: (posts: Mutator) => posts.updateAll({}) })).toBe(graphOf());
  });

  it('applies the update defaults of the related model', () => {
    const context: Context = {
      ...getTestContext(),
      applyMutationDefaults: (options) =>
        options.op === 'update' && options.entry === 'posts' ? [{ field: 'views', value: 99 }] : [],
    };

    expect(
      printUpdate(
        { posts: (posts: Mutator) => posts.updateAll({ title: 'Published' }) },
        'User',
        context,
      ),
    ).toBe(
      graphOf("n2 Update posts set title = 'Published', views = 99 <- FilterData n1 (id->user_id)"),
    );
  });

  it('adds the operations of an array in order', () => {
    expect(
      printUpdate({
        posts: (posts: Mutator) => [
          posts.create([{ id: 10, title: 'New', views: 0 }]),
          posts.where({ title: 'Draft' }).updateAll({ title: 'Published' }),
          posts.deleteAll(),
        ],
      }),
    ).toBe(
      graphOf(
        'n2 Insert posts <- PayloadData n1 (id->user_id)',
        "n3 Update posts set title = 'Published' where title = 'Draft' <- FilterData n1 (id->user_id)",
        'n4 Delete posts <- FilterData n1 (id->user_id)',
      ),
    );
  });
});

describe('updateAll and deleteAll rejections while the graph is built', () => {
  it.each([
    ['updateAll', (posts: Mutator) => posts.updateAll({ views: 1 })],
    ['deleteAll', (posts: Mutator) => posts.where({ title: 'Draft' }).deleteAll()],
  ])('rejects %s in create()', (kind, posts) => {
    expect(() => printCreate({ id: 1, name: 'Ada', email: 'ada@example.com', posts })).toThrow(
      expect.objectContaining({
        code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
        message: `${kind}() is only supported in update() nested mutations`,
        meta: { kind, relation: 'posts' },
      }),
    );
  });

  it.each([
    ['Post', 'author', (author: Mutator) => author.where({ id: 1 }).deleteAll(), 'deleteAll'],
    ['User', 'profile', (profile: Mutator) => profile.updateAll({ bio: 'New' }), 'updateAll'],
  ] as const)('rejects on the to-one relation %s.%s', (modelName, relation, callback, kind) => {
    expect(() => printUpdate({ [relation]: callback }, modelName)).toThrow(
      expect.objectContaining({
        code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
        message: `${kind}() nested mutation for relation "${relation}" is only supported on to-many relations`,
        meta: { kind, relation, reason: 'to-one-relation' },
      }),
    );
  });

  it('rejects updateAll data that sets the field linking the children to the parent', () => {
    expect(() =>
      printUpdate({ posts: (posts: Mutator) => posts.updateAll({ title: 'a', userId: 2 }) }),
    ).toThrow(
      expect.objectContaining({
        code: 'ORM.RELATION_MUTATION_INVALID',
        message:
          'updateAll() nested mutation for relation "posts" cannot set "userId", which links the related rows to their parent',
        meta: {
          kind: 'updateAll',
          relation: 'posts',
          problem: 'parent-link-column',
          fields: ['userId'],
        },
      }),
    );
  });

  it('rejects updateAll and deleteAll on a many-to-many relation', () => {
    expect(() => printUpdate({ tags: (tags: Mutator) => tags.deleteAll() })).toThrow(
      expect.objectContaining({
        code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
        message:
          'deleteAll() nested mutation for relation "tags" is not supported on a many-to-many relation yet',
        meta: { kind: 'deleteAll', relation: 'tags', reason: 'many-to-many-relation' },
      }),
    );
  });
});
