import { createHash } from 'crypto';
import {
  BuyingCommitteeRole,
  ProspectDiscoveryIcpInput,
  buyerRoleSchema,
} from './prospect-discovery.types';

/** Map Company Brain personas into likely buyer roles for a candidate (abstract roles, not people). */
export function mapBuyerRolesFromPersonas(
  brain: ProspectDiscoveryIcpInput,
  options: { companyName: string; providerKey: string } = {
    companyName: '',
    providerKey: '',
  },
): BuyingCommitteeRole[] {
  return brain.personas.map(persona => {
    const id = createHash('sha1')
      .update(`${options.providerKey}:${persona.id}`)
      .digest('hex')
      .slice(0, 12);
    return buyerRoleSchema.parse({
      id: `role_${id}`,
      role: persona.role,
      function: persona.function ?? null,
      seniority: persona.seniority ?? null,
      buyingInfluence: persona.buyingInfluence ?? 'champion',
      rationale: `Likely buyer role for ${options.companyName || 'target'} based on Company Brain persona ${persona.role}`,
      matchedCompanyBrainPersonaId: persona.id,
      confidence: 0.75,
      evidence: [
        {
          source: 'company-brain-persona',
          excerpt: persona.role,
          field: 'persona.role',
          confidence: 0.75,
        },
      ],
    });
  });
}
