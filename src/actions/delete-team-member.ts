"use server";

import { db } from "@/db";
import { TEAM_MEMBER_ROLES, teamMembers, teams } from "@/db/schema";
import { authOptions } from "@/lib/next-auth";
import { rateLimit } from "@/lib/rate-limit";
import { getIPAddress } from "@/lib/server-actions";
import { and, eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const schema = z.object({
  memberId: z.string({
    invalid_type_error: "Invalid member ID",
  }),
});

export async function deleteTeamMember(teamId: string, formData: FormData) {
  await rateLimit((await getIPAddress()) ?? "anonymous");

  const session = await getServerSession(authOptions);

  if (!session) {
    throw Error("Unauthenticated");
  }

  const validatedFields = schema.safeParse({
    memberId: formData.get("memberId"),
  });

  if (!validatedFields.success) {
    throw new Error(
      validatedFields.error.flatten().fieldErrors.memberId?.join(", "),
    );
  }

  const team = await db.query.teams.findFirst({
    where: and(eq(teams.id, teamId)),
    with: {
      members: {
        with: {
          user: true,
        },
      },
    },
  });

  if (!team) {
    throw new Error("Team not found");
  }

  const user = team.members.find(m => m.user.email === session.user.email);
  const member = team.members.find(m => m.user.email === formData.get("email"));

  if (!user) {
    throw new Error("You are not a member of this team");
  }

  if (user.role !== TEAM_MEMBER_ROLES.ADMIN) {
    throw new Error("You are not an admin of this team");
  }

  if (!member) {
    throw new Error("Member not found");
  }

  if (
    team.members.filter(m => m.role === TEAM_MEMBER_ROLES.ADMIN).length < 2 &&
    member.role === TEAM_MEMBER_ROLES.ADMIN
  ) {
    throw new Error("You cannot remove the last admin of a team");
  }

  if (team.members.length < 2) {
    throw new Error("You cannot remove the last member of a team");
  }

  await db
    .delete(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        eq(teamMembers.userId, formData.get("memberId") as string),
      ),
    );

  revalidatePath("/settings/teams", "page");
  revalidatePath("/settings/teams/[id]", "page");
}
