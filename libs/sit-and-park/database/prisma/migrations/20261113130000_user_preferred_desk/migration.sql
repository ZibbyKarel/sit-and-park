-- `User.preferredDeskId`: the first choice for desk bulk booking. Nullable,
-- and set to NULL when the desk goes, like `preferredParkingSpotId`.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "preferredDeskId" UUID;

-- CreateIndex
CREATE INDEX "User_preferredDeskId_idx" ON "User"("preferredDeskId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_preferredDeskId_fkey" FOREIGN KEY ("preferredDeskId") REFERENCES "Desk"("id") ON DELETE SET NULL ON UPDATE CASCADE;
