import { describe, expect, it } from 'vitest';
import type { Agent, Team } from '@orbit/types';
import { buildTeamRegions, findTeamAtPoint } from './team-bounds';

function makeAgent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    name: id.toUpperCase(),
    emoji: '🌟',
    color: '#5E6AD2',
    workingDir: '/tmp',
    sessionId: null,
    modelOverride: null,
    status: 'idle',
    soul: null,
    purpose: null,
    identityDirty: 0,
    folderAccess: '[]',
    teamId: null,
    positionX: 0,
    positionY: 0,
    createdAt: '2026-05-06T00:00:00Z',
    updatedAt: '2026-05-06T00:00:00Z',
    ...overrides,
  };
}

function makeTeam(id: string, overrides: Partial<Team> = {}): Team {
  return {
    id,
    name: id.toUpperCase(),
    color: '#3a4a3e',
    hintX: null,
    hintY: null,
    hintWidth: null,
    hintHeight: null,
    createdAt: '2026-05-06T00:00:00Z',
    updatedAt: '2026-05-06T00:00:00Z',
    ...overrides,
  };
}

describe('buildTeamRegions', () => {
  it('returns nothing when there are no teams', () => {
    expect(buildTeamRegions([], {}, {})).toEqual([]);
  });

  it('uses the hint placeholder when a team has no members', () => {
    const team = makeTeam('t1', { hintX: 100, hintY: 200, hintWidth: 240, hintHeight: 120 });
    const regions = buildTeamRegions(['t1'], { t1: team }, {});
    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({ x: 100, y: 200, width: 240, height: 120, memberCount: 0 });
  });

  it('uses the default placeholder when a team has no members and no hint', () => {
    const regions = buildTeamRegions(['t1'], { t1: makeTeam('t1') }, {});
    expect(regions[0]).toMatchObject({ width: 240, height: 120, memberCount: 0 });
  });

  it('hugs a single member with padding + label headroom', () => {
    const team = makeTeam('t1');
    const agent = makeAgent('a', { teamId: 't1', positionX: 100, positionY: 200 });
    const [region] = buildTeamRegions(['t1'], { t1: team }, { a: agent });
    expect(region!.memberCount).toBe(1);
    // Member top-left = (100, 200), node footprint 176×72.
    // Padding = 16, label headroom = 8.
    expect(region!.x).toBe(100 - 16);
    expect(region!.y).toBe(200 - 16 - 8);
    expect(region!.width).toBe(176 + 16 * 2);
    expect(region!.height).toBe(72 + 16 * 2 + 8);
  });

  it('spans the bounding box of multiple members', () => {
    const team = makeTeam('t1');
    const agents = {
      a: makeAgent('a', { teamId: 't1', positionX: 0, positionY: 0 }),
      b: makeAgent('b', { teamId: 't1', positionX: 400, positionY: 300 }),
    };
    const [region] = buildTeamRegions(['t1'], { t1: team }, agents);
    expect(region!.memberCount).toBe(2);
    expect(region!.x).toBe(-16);
    expect(region!.y).toBe(-16 - 8);
    expect(region!.width).toBe(400 + 176 + 16 * 2);
    expect(region!.height).toBe(300 + 72 + 16 * 2 + 8);
  });

  it('skips agents whose teamId does not match', () => {
    const t1 = makeTeam('t1');
    const t2 = makeTeam('t2');
    const agents = {
      a: makeAgent('a', { teamId: 't1', positionX: 0, positionY: 0 }),
      b: makeAgent('b', { teamId: 't2', positionX: 400, positionY: 300 }),
    };
    const regions = buildTeamRegions(['t1', 't2'], { t1, t2 }, agents);
    expect(regions).toHaveLength(2);
    expect(regions[0]!.memberCount).toBe(1);
    expect(regions[1]!.memberCount).toBe(1);
  });
});

describe('findTeamAtPoint', () => {
  const big = {
    id: 'big',
    name: 'BIG',
    color: '#000',
    x: 0,
    y: 0,
    width: 500,
    height: 500,
    memberCount: 1,
  };
  const small = {
    id: 'small',
    name: 'SMALL',
    color: '#000',
    x: 100,
    y: 100,
    width: 100,
    height: 100,
    memberCount: 1,
  };

  it('returns null when the point falls outside every region', () => {
    expect(findTeamAtPoint([big, small], { x: 600, y: 600 })).toBeNull();
  });

  it('returns the only enclosing region when there is no overlap', () => {
    expect(findTeamAtPoint([big, small], { x: 250, y: 250 })?.id).toBe('big');
  });

  it('picks the smallest enclosing region when regions overlap (nested)', () => {
    expect(findTeamAtPoint([big, small], { x: 150, y: 150 })?.id).toBe('small');
  });

  it('treats the boundary as inside the region', () => {
    // Drop exactly on the small region's top-left corner.
    expect(findTeamAtPoint([big, small], { x: 100, y: 100 })?.id).toBe('small');
  });
});
