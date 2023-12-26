import generatePackageJson from 'rollup-plugin-generate-package-json';
import ts from 'rollup-plugin-typescript2';
import cjs from '@rollup/plugin-commonjs';
import clear from 'rollup-plugin-clear';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import { resolvePkgPath, getPackageJSON } from './utils';

const { name, module } = getPackageJSON('react');
const pkgPath = resolvePkgPath(name);
const pkgDistPath = resolvePkgPath(name, true);

export default {
  input: `${pkgPath}/${module}`,
  output: {
    file: `${pkgDistPath}/index.js`,
    name: 'index',
    format: 'umd'
  },
  plugins: [
    nodeResolve({
      exportConditions: ['node'],
      extensions: ['.ts', '.mjs', '.js', '.json', '.node']
    }),
    ts({}),
    cjs(),
    generatePackageJson({
      inputFolder: pkgPath,
      outputFolder: pkgDistPath,
      baseContents: ({ name, description, version }) => ({
        name,
        description,
        version,
        main: 'index.js'
      })
    }),
    clear({
      targets: ['dist']
    }),
    replace({
      alias: {
        __DEV__: true,
        preventAssignment: true
      },
    })
  ]
};
