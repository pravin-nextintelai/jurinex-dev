/**
 * Universal Sections API – fetch from agent-draft-service (no hardcoded list).
 * GET /api/universal-sections returns sections; we map to UniversalSection shape.
 */

import { api } from './api';
import type { UniversalSection } from '../components/constants';

interface ApiSection {
  section_key: string;
  section_name: string;
  sort_order?: number;
  is_required?: boolean;
  default_prompt: string;
}

function mapToUniversalSection(s: ApiSection, index: number): UniversalSection {
  return {
    id: s.section_key || `section_${index}`,
    title: s.section_name || `Section ${index + 1}`,
    description: s.section_name || '',
    defaultPrompt: s.default_prompt || '',
    subItems: [],
  };
}

let cached: UniversalSection[] | null = null;

/**
 * Fetch universal sections from backend. Returns empty array on failure.
 * Result is cached for the session to avoid repeated requests.
 */
export async function getUniversalSections(): Promise<UniversalSection[]> {
  if (cached) return cached;
  try {
    const res = await api.get<{ success?: boolean; sections?: ApiSection[] }>('/universal-sections');
    const list = res.data?.sections;
    if (!Array.isArray(list) || list.length === 0) return [];
    cached = list.map(mapToUniversalSection);
    return cached;
  } catch {
    return [];
  }
}

/** Clear cache (e.g. after backend config change). */
export function clearUniversalSectionsCache(): void {
  cached = null;
}
