<script setup lang="ts">
/**
 * Loading placeholder for /species/view. It copies SpeciesPage's classes and the
 * usual content (photos, intro, names, ten countries, five datasets) so nothing moves when the data lands.
 */
import SkeletonBlock from '~/components/atoms/SkeletonBlock.vue';
import IntroSkeleton from '~/components/molecules/IntroSkeleton.vue';
import SkeletonLine from '~/components/molecules/SkeletonLine.vue';

/** Plot heights from PlotChart (years: 170; bars: rows × 26 + 34) and RadialSeasonality (240). */
const CHARTS = [
  { title: '8rem', plot: '170px', compact: false },
  { title: '9rem', plot: '240px', compact: true },
  { title: '7rem', plot: '294px', compact: false },
  { title: '12rem', plot: '164px', compact: false },
];

const BADGE_HEIGHT = 'calc(1.25rem + 2px)';
const BUTTON_HEIGHT = 'calc(2.25rem + 2px)';
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 pt-6 sm:px-6" role="status" aria-label="Loading species">
    <SkeletonLine class="mb-3 text-xs" width="min(22rem, 100%)" />

    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div class="min-w-0">
        <SkeletonLine class="font-display text-4xl leading-tight sm:text-5xl" width="min(20rem, 85vw)" />
        <SkeletonLine class="mt-1 text-lg" width="11rem"><span class="sci-name">&#8203;</span></SkeletonLine>
        <div class="mt-2 flex gap-2">
          <SkeletonBlock width="3.75rem" :height="BADGE_HEIGHT" rounded="full" aria-hidden="true" />
          <SkeletonBlock width="7rem" :height="BADGE_HEIGHT" rounded="full" aria-hidden="true" />
        </div>
      </div>
      <div class="flex gap-2">
        <SkeletonBlock width="7.125rem" :height="BUTTON_HEIGHT" aria-hidden="true" />
        <SkeletonBlock width="6.125rem" :height="BUTTON_HEIGHT" aria-hidden="true" />
      </div>
    </div>

    <div class="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div>
        <div class="grid gap-1.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <SkeletonBlock class="aspect-[4/3]" height="auto" rounded="lg" aria-hidden="true" />
          <div class="grid grid-cols-4 content-start gap-1.5 sm:grid-cols-2">
            <SkeletonBlock v-for="slot in 4" :key="slot" class="aspect-square" height="auto" aria-hidden="true" />
          </div>
        </div>
        <IntroSkeleton aria-hidden="true" />
      </div>
      <div class="space-y-4">
        <div>
          <SkeletonBlock class="aspect-square" height="auto" aria-hidden="true" />
          <SkeletonLine class="mt-1 text-xs" width="60%" />
        </div>
        <div>
          <SkeletonLine class="mb-2 font-display text-xl" width="9rem" />
          <SkeletonLine class="text-sm" width="80%" />
          <SkeletonLine class="mt-2 text-sm" width="8rem" />
        </div>
      </div>
    </div>

    <div class="mt-10">
      <SkeletonLine class="mb-4 font-display text-2xl" width="6rem" />
      <div class="grid gap-8 md:grid-cols-2">
        <div v-for="(chart, index) in CHARTS" :key="index" :class="chart.compact ? 'text-xs' : 'text-sm'">
          <SkeletonLine class="mb-2" :width="chart.title" />
          <SkeletonBlock :height="chart.plot" aria-hidden="true" />
          <SkeletonLine class="mt-1.5 text-xs" width="7rem" />
        </div>
      </div>
    </div>
  </div>
</template>
