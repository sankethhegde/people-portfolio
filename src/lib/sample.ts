import { db, uid } from '../db';
import type { Label, LabelGroup, Person, SocialLink } from '../types';
import { LABEL_COLORS } from './colors';

/** Generates fake people for trying the app and checking performance (acceptance: 500 people). */

const FIRST = ['Aarav', 'Ananya', 'Rohan', 'Isha', 'Vikram', 'Meera', 'Arjun', 'Kavya', 'Nikhil', 'Diya', 'Sameer', 'Priya', 'Karan', 'Neha', 'Aditya', 'Sneha', 'Rahul', 'Pooja', 'Varun', 'Tara', 'Liam', 'Emma', 'Noah', 'Olivia', 'Mateo', 'Sofia', 'Yuki', 'Hana', 'Omar', 'Layla'];
const LAST = ['Hegde', 'Rao', 'Shetty', 'Iyer', 'Kamath', 'Nair', 'Sharma', 'Gupta', 'Reddy', 'Pai', 'Bhat', 'Menon', 'Kulkarni', 'Joshi', 'Patil', 'Smith', 'Garcia', 'Tanaka', 'Haddad', 'Silva'];
const GROUPS: Record<string, string[]> = {
  Relation: ['Family', 'Friend', 'Colleague', 'Classmate', 'Neighbour'],
  City: ['Bengaluru', 'Mumbai', 'Udupi', 'Mysuru', 'Pune', 'Chennai', 'London'],
  Interest: ['Photography', 'Music', 'Cricket', 'Travel', 'Coding', 'Cooking', 'Art'],
};
const BIO = ['Met at college.', 'Loves trekking and filter coffee.', 'Works in product design.', 'Runs a small bakery.', 'Amateur astronomer.', 'Plays guitar in a weekend band.', ''];

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

export async function addSamplePeople(count = 500) {
  const groups: LabelGroup[] = [];
  const labels: Label[] = [];
  const existingGroups = await db.groups.toArray();
  const existingLabels = await db.labels.toArray();
  let order = existingGroups.length;
  let colorIdx = 0;

  const byGroup: Record<string, Label[]> = {};
  for (const [gName, names] of Object.entries(GROUPS)) {
    let g = existingGroups.find((x) => x.name === gName);
    if (!g) groups.push((g = { id: uid(), name: gName, order: ++order }));
    byGroup[gName] = names.map((n) => {
      let l = existingLabels.find((x) => x.groupId === g!.id && x.name === n);
      if (!l) labels.push((l = { id: uid(), name: n, color: LABEL_COLORS[colorIdx++ % LABEL_COLORS.length], groupId: g!.id }));
      return l;
    });
  }

  const start = Date.now() - 400 * 864e5;
  const people: Person[] = Array.from({ length: count }, () => {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const handle = name.toLowerCase().replace(/\s+/g, '.');
    const labelIds = new Set<string>([pick(byGroup.Relation).id, pick(byGroup.City).id]);
    for (let i = Math.floor(Math.random() * 4); i > 0; i--) labelIds.add(pick(byGroup.Interest).id);
    const links: SocialLink[] = [];
    if (Math.random() < 0.7) links.push({ platform: 'instagram', url: `https://instagram.com/${handle}` });
    if (Math.random() < 0.4) links.push({ platform: 'linkedin', url: `https://linkedin.com/in/${handle}` });
    if (Math.random() < 0.3) links.push({ platform: 'reddit', url: `https://reddit.com/user/${handle}` });
    if (Math.random() < 0.2) links.push({ platform: 'github', url: `https://github.com/${handle}` });
    const created = new Date(start + Math.random() * 400 * 864e5).toISOString();
    return {
      id: uid(),
      name,
      labelIds: [...labelIds],
      socialLinks: links,
      bio: pick(BIO) || undefined,
      nationality: Math.random() < 0.7 ? pick(['Indian', 'Indian', 'Indian', 'British', 'American', 'Japanese', 'Brazilian']) : undefined,
      birthYear: Math.random() < 0.7 ? new Date().getFullYear() - (18 + Math.floor(Math.random() * 50)) : undefined,
      createdAt: created,
      updatedAt: created,
    };
  });

  await db.transaction('rw', db.groups, db.labels, db.people, async () => {
    await db.groups.bulkAdd(groups);
    await db.labels.bulkAdd(labels);
    await db.people.bulkAdd(people);
  });
}
