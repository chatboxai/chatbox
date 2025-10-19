import type { Configuration } from 'webpack';

import { rules } from './webpack.rules';
import { plugins } from './webpack.plugins';

rules.push(
  {
      test: /\.css$/,
      use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
  },
  {
      test: /\.s[ca]ss$/,
      use: [
        { loader: 'style-loader' }, 
        { loader: 'css-loader' }, 
        { 
          loader: 'sass-loader',
          options: {
            api: 'modern'
          }
        }
      ],
  }
);

export const rendererConfig: Configuration = {
  module: {
    rules,
  },
  plugins,
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css'],
  },
};
