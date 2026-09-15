import type { Site } from "@prisma/client";
import { prisma } from "./prisma";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "./secrets";

/** Credentials for WP calls — decrypts at use; upgrades legacy plaintext in DB */
export async function siteWpAuth(site: Site) {
  let password = decryptSecret(site.wpAppPassword);

  if (!isEncryptedSecret(site.wpAppPassword)) {
    const sealed = encryptSecret(password);
    await prisma.site.update({
      where: { id: site.id },
      data: { wpAppPassword: sealed },
    });
    site.wpAppPassword = sealed;
  }

  return {
    baseUrl: site.baseUrl,
    username: site.wpUsername,
    appPassword: password,
  };
}
