# Globby + patch

When packaging rollup into deno, an implementation difference between how directory stats
works was causing a failure on windows.

#### The dependency tree

```
noun_and_verb
└── globby@11.1.0
    └── dir-glob@3.0.1
        └── path-type@4.0.0
```

#### The root cause

Deep within `path-type` code, this is the call to the compatibility layer.

```javascript
async function isType(fsStatType, statsMethodName, filePath) {
  if (typeof filePath !== "string") {
    throw new TypeError(`Expected a string, got ${typeof filePath}`);
  }

  try {
    const stats = await fsPromises[fsStatType](filePath);
    return stats[statsMethodName]();
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function isTypeSync(fsStatType, statsMethodName, filePath) {
  if (typeof filePath !== "string") {
    throw new TypeError(`Expected a string, got ${typeof filePath}`);
  }

  try {
    return fs[fsStatType](filePath)[statsMethodName]();
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}
```

`globby` passes in file-globs for the `filePath` argument. This causes trouble since
on `deno` + `windows`, the error.code being returned here is `EINVAL`

```
error: Error: EINVAL: invalid argument, stat
    at __node_internal_captureLargerStackTrace (https://deno.land/std@0.123.0/node/internal/errors.ts:65:11)
    at __node_internal_uvException (https://deno.land/std@0.123.0/node/internal/errors.ts:158:12)
    at denoErrorToNodeError (https://deno.land/std@0.123.0/node/internal/errors.ts:1788:16)
    at Object.statSync (https://deno.land/std@0.123.0/node/_fs/_fs_stat.ts:113:19)
    at isTypeSync (file:///my/source/bundle.js)
    at file:///my/source/bundle.js:L#:C#)
    at Array.map (<anonymous>)
    at dirGlob$1.exports.sync (file:///my/source/bundle.js:L#:C#)
    at globDirs (file:///my/source/bundle.js:L#:C#)
    at getPattern (file:///my/source/bundle.js:L#:C#)

```

### Solution point (original code)

Within `dir-glob`, this becomes an un-expected error, upsetting our apple-cart.

```javascript
module.exports = async (input, options) => {
  options = {
    cwd: process.cwd(),
    ...options,
  };

  if (typeof options.cwd !== "string") {
    throw new TypeError(
      `Expected \`cwd\` to be of type \`string\` but received type \`${typeof options.cwd}\``
    );
  }

  const globs = await Promise.all(
    [].concat(input).map(async (x) => {
      const isDirectory = await pathType.isDirectory(getPath(x, options.cwd));
      return isDirectory ? getGlob(x, options) : x;
    })
  );

  return [].concat(...globs);
};

module.exports.sync = (input, options) => {
  options = {
    cwd: process.cwd(),
    ...options,
  };

  if (typeof options.cwd !== "string") {
    throw new TypeError(
      `Expected \`cwd\` to be of type \`string\` but received type \`${typeof options.cwd}\``
    );
  }

  const globs = []
    .concat(input)
    .map((x) =>
      pathType.isDirectorySync(getPath(x, options.cwd))
        ? getGlob(x, options)
        : x
    );

  return [].concat(...globs);
};
```

### The patch

Notice the `try-catch` blocks around calls to `isDirectory` and `isDirectorySync`.

```javascript
module.exports = async (input, options) => {
  options = {
    cwd: process.cwd(),
    ...options,
  };

  if (typeof options.cwd !== "string") {
    throw new TypeError(
      `Expected \`cwd\` to be of type \`string\` but received type \`${typeof options.cwd}\``
    );
  }

  const globs = await Promise.all(
    [].concat(input).map(async (x) => {
      try {
        const isDirectory = await pathType.isDirectory(getPath(x, options.cwd));
        return isDirectory ? getGlob(x, options) : x;
      } catch {
        return x;
      }
    })
  );

  return [].concat(...globs);
};

module.exports.sync = (input, options) => {
  options = {
    cwd: process.cwd(),
    ...options,
  };

  if (typeof options.cwd !== "string") {
    throw new TypeError(
      `Expected \`cwd\` to be of type \`string\` but received type \`${typeof options.cwd}\``
    );
  }

  const globs = [].concat(input).map((x) => {
    try {
      pathType.isDirectorySync(getPath(x, options.cwd))
        ? getGlob(x, options)
        : x;
    } catch {
      return x;
    }
  });

  return [].concat(...globs);
};
```

## The solution
Given the nested nature of this patch, and the fact that globby is now published as an esm module, 
providing a patched version for our use is needlessly complicated. 

This module uses rollup to bundle all the dependencies into a single file, and then relies on 
the patch being applied manually to get us to a release.

Hacky, but effective.