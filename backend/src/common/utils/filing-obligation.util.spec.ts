import { EntityStatus, EntityType } from '@prisma/client';
import { obligedEntityFilter, typesObligedBy } from './filing-obligation.util';

describe('typesObligedBy', () => {
  it('takes the union across sections, not the intersection', () => {
    // The trap this guards: a questionnaire whose first section is for mobile operators and whose
    // second is for ISPs applies to both. Intersecting would oblige nobody.
    expect(
      typesObligedBy([
        { applicableEntityTypes: [EntityType.MNO] },
        { applicableEntityTypes: [EntityType.ISP] },
      ]).sort(),
    ).toEqual([EntityType.ISP, EntityType.MNO]);
  });

  it('counts a type once when several sections name it', () => {
    expect(
      typesObligedBy([
        { applicableEntityTypes: [EntityType.MNO, EntityType.ISP] },
        { applicableEntityTypes: [EntityType.MNO] },
      ]),
    ).toHaveLength(2);
  });

  it('obliges nobody when no section names a type', () => {
    expect(typesObligedBy([{ applicableEntityTypes: [] }])).toEqual([]);
    expect(typesObligedBy([])).toEqual([]);
  });
});

describe('obligedEntityFilter', () => {
  it('holds a licence that is live, of a covered type', () => {
    expect(obligedEntityFilter([EntityType.MNO])).toEqual({
      status: EntityStatus.ACTIVE,
      deletedAt: null,
      type: { in: [EntityType.MNO] },
    });
  });

  it('matches nothing when no type is covered', () => {
    // `in: []` matches no row, which is the honest answer: a questionnaire addressed to nobody
    // obliges nobody. It must not fall through to "every operator".
    expect(obligedEntityFilter([]).type).toEqual({ in: [] });
  });
});
