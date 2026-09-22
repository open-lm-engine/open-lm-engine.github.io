import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/blog' }),
  schema: ({ image }) => z.object({
    title: z.string(),
    subtitle: z.string().optional(),
    description: z.string(),
    heroImage: image().optional(),
    author: z.string().optional(),
    authors: z
      .array(
        z.object({
          name: z.string(),
          url: z.string().optional(),
          affiliations: z.array(z.number()).optional(),
          equalAdvising: z.boolean().optional(),
        })
      )
      .optional(),
    affiliations: z.array(z.string()).optional(),
    draft: z.boolean().optional().default(false),
    citationStyle: z.enum(['numeric', 'text']).optional().default('text'),
    bibliography: z.string().optional(),
    codeColor: z.enum(['pink', 'green']).optional().default('green'),
    // opts a post into the starfield background and its controls
    sky: z.boolean().optional().default(false),
    // description in front of the dark-mode toggle under the title
    skyPrompt: z.string().optional(),
    // paper-style abstract shown in the hero under the byline
    abstract: z.string().optional(),
    // external resources shown as pills under the byline (models, code, paper)
    links: z
      .array(
        z.object({
          label: z.string(),
          href: z.string(),
          // a short emoji or symbol drawn before the label
          icon: z.string().optional(),
        })
      )
      .optional(),
  }),
});

export const collections = { blog };
