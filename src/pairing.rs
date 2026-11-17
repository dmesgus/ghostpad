//! Persistent bearer credentials. Never follow a pairing-file symlink or read an unbounded file.
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};

unsafe extern "C" {
    fn geteuid() -> u32;
}

pub fn is_root() -> bool {
    // POSIX geteuid has no failure mode and does not retain pointers.
    unsafe { geteuid() == 0 }
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

pub fn token(rotate: bool) -> io::Result<String> {
    let base = match std::env::var_os("XDG_CONFIG_HOME").filter(|value| !value.is_empty()) {
        Some(value) => PathBuf::from(value),
        None => PathBuf::from(
            std::env::var_os("HOME")
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    invalid("Set HOME or an absolute XDG_CONFIG_HOME for saved pairing")
                })?,
        )
        .join(".config"),
    };
    if !base.is_absolute() {
        return Err(invalid("HOME and XDG_CONFIG_HOME must be absolute paths"));
    }
    load(&base.join("ghostpad"), rotate)
}

fn load(dir: &Path, rotate: bool) -> io::Result<String> {
    fs::create_dir_all(
        dir.parent()
            .ok_or_else(|| invalid("Invalid config directory"))?,
    )?;
    match fs::DirBuilder::new().mode(0o700).create(dir) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error),
    }
    let meta = fs::symlink_metadata(dir)?;
    // Do not chmod a link destination or a directory belonging to another user.
    if !meta.is_dir() || meta.uid() != unsafe { geteuid() } {
        return Err(invalid(
            "Pairing directory must be a real directory owned by your user",
        ));
    }
    fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    let path = dir.join("pairing-key");
    if rotate {
        // Create and sync the replacement before revoking the existing key. A failed
        // write must not erase a working credential. rename replaces a link itself.
        let key = crate::crypto::secret()?;
        let temporary = dir.join(format!(".pairing-{}", crate::crypto::secret()?));
        let result = (|| {
            let mut file = create(&temporary)?;
            file.write_all(key.as_bytes())?;
            file.sync_all()?;
            fs::rename(&temporary, &path)?;
            File::open(dir)?.sync_all()?;
            Ok(key)
        })();
        let _ = fs::remove_file(&temporary);
        return result;
    }
    match create(&path) {
        Ok(mut file) => {
            let result = (|| {
                let key = crate::crypto::secret()?;
                file.write_all(key.as_bytes())?;
                file.sync_all()?;
                Ok(key)
            })();
            if result.is_err() {
                let _ = fs::remove_file(&path);
            }
            result
        }
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            // Linux O_NOFOLLOW | O_NONBLOCK: refuse symlinks and avoid blocking on
            // a FIFO before its descriptor metadata can be checked.
            let file = OpenOptions::new()
                .read(true)
                .custom_flags(0x20000 | 0x800)
                .open(&path)?;
            let meta = file.metadata()?;
            if !meta.is_file()
                || meta.uid() != unsafe { geteuid() }
                || meta.nlink() != 1
                || meta.permissions().mode() & 0o077 != 0
                || meta.len() != 64
            {
                return Err(invalid(
                    "Pairing key must be a private 64-byte regular file owned by your user without extra hard links; use --rotate-key to replace it",
                ));
            }
            let mut key = String::new();
            file.take(65).read_to_string(&mut key)?;
            if key.len() != 64 || !key.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err(invalid("Invalid saved pairing key; use --rotate-key"));
            }
            Ok(key)
        }
        Err(error) => Err(error),
    }
}

fn create(path: &Path) -> io::Result<File> {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    struct Directory(PathBuf);
    impl Directory {
        fn new() -> Self {
            let path = std::env::temp_dir()
                .join(format!("ghostpad-key-{}", crate::crypto::secret().unwrap()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn config(&self) -> PathBuf {
            self.0.join("ghostpad")
        }
        fn key(&self) -> PathBuf {
            self.config().join("pairing-key")
        }
    }
    impl Drop for Directory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn persists_with_private_permissions_and_rotates_atomically() {
        let dir = Directory::new();
        let old = load(&dir.config(), false).unwrap();
        assert_eq!(load(&dir.config(), false).unwrap(), old);
        assert_eq!(
            fs::metadata(dir.config()).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(dir.key()).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let new = load(&dir.config(), true).unwrap();
        assert_ne!(old, new);
        assert_eq!(load(&dir.config(), false).unwrap(), new);
        assert_eq!(fs::read_dir(dir.config()).unwrap().count(), 1);
    }

    #[test]
    fn rejects_file_links_and_rotation_preserves_the_target() {
        let dir = Directory::new();
        fs::create_dir(dir.config()).unwrap();
        let target = dir.0.join("other");
        fs::write(&target, "a".repeat(64)).unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o600)).unwrap();
        symlink(&target, dir.key()).unwrap();
        assert!(load(&dir.config(), false).is_err());
        let key = load(&dir.config(), true).unwrap();
        assert_eq!(fs::read_to_string(target).unwrap(), "a".repeat(64));
        assert_eq!(fs::read_to_string(dir.key()).unwrap(), key);
    }

    #[test]
    fn rejects_directory_links_without_changing_target_permissions() {
        let dir = Directory::new();
        let target = dir.0.join("other");
        fs::create_dir(&target).unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o755)).unwrap();
        symlink(&target, dir.config()).unwrap();
        assert!(load(&dir.config(), false).is_err());
        assert_eq!(
            fs::metadata(target).unwrap().permissions().mode() & 0o777,
            0o755
        );
    }

    #[test]
    fn rejects_shared_corrupt_oversized_and_hardlinked_keys() {
        let dir = Directory::new();
        load(&dir.config(), false).unwrap();
        fs::set_permissions(dir.key(), fs::Permissions::from_mode(0o644)).unwrap();
        assert!(load(&dir.config(), false).is_err());
        fs::set_permissions(dir.key(), fs::Permissions::from_mode(0o600)).unwrap();
        for value in ["z".repeat(64), "a".repeat(65), String::new()] {
            fs::write(dir.key(), value).unwrap();
            assert!(load(&dir.config(), false).is_err());
        }
        fs::write(dir.key(), "a".repeat(64)).unwrap();
        fs::hard_link(dir.key(), dir.0.join("copy")).unwrap();
        assert!(load(&dir.config(), false).is_err());
        assert!(load(&dir.config(), true).is_ok());
    }
}
