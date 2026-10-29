import { retryPhotos } from '../photos';
import { requestFolderAccess } from '../photos/localSource';

/**
 * Click handler: re-grant one folder, then re-check every photo straight away (also when the
 * request fails, so nothing stays stuck on an old answer). Returns whether access was granted.
 */
export async function allowFolder(folderId: string): Promise<boolean> {
  const ok = await requestFolderAccess(folderId);
  retryPhotos();
  return ok;
}
