-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "githubSyncedAt" TIMESTAMP(3),
ADD COLUMN     "zohoSyncedAt" TIMESTAMP(3);
