import { EntityStatus, EntityType, Prisma } from '@prisma/client';

/**
 * Who owes a return for a reporting period.
 *
 * The rule is small but it is read from two places that must never disagree: enforcement opens a
 * missed-deadline case against every operator on this list that did not file, and analytics uses
 * the same list as the denominator of the compliance rate. If the two drifted apart, a chart could
 * show every operator compliant in a period where enforcement had opened cases against four of
 * them, and nobody would be able to tell which number was wrong.
 *
 * So the rule lives here once, as two plain pieces: which operator types a period covers, and which
 * operators of those types are actually on the hook.
 */

/**
 * The operator types a period's questionnaire applies to: the union of its sections.
 *
 * A questionnaire is built from sections, and each section names the types it applies to. An
 * operator owes a return if any single section is addressed to it, because filing is per return,
 * not per section: an ISP asked only Section 4 still owes the return that carries Section 4.
 */
export function typesObligedBy(
  sections: readonly { applicableEntityTypes: EntityType[] }[],
): EntityType[] {
  const types = new Set<EntityType>();
  for (const section of sections) {
    for (const type of section.applicableEntityTypes) types.add(type);
  }
  return [...types];
}

/**
 * Which operators are on the hook, given the types a period covers.
 *
 * Active and not deleted, because a licence that has been suspended or surrendered carries no
 * filing duty. Note this is deliberately the operator's status *now*, not at the deadline: the
 * portal does not keep a history of licence status, so a figure computed today is a statement about
 * today's register. It is the same basis enforcement has always swept on.
 */
export function obligedEntityFilter(types: readonly EntityType[]): Prisma.EntityWhereInput {
  return {
    status: EntityStatus.ACTIVE,
    deletedAt: null,
    type: { in: [...types] },
  };
}
