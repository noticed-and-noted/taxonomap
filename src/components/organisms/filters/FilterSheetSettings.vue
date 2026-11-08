<script setup lang="ts">
/** The phone Filters sheet's Map tab: basemap, theme, map, reading and search settings, the legal links and the version. */
import BuildInfo from '~/components/atoms/BuildInfo.vue';
import LegalLinks from '~/components/atoms/LegalLinks.vue';
import BasemapSwitcher from '~/components/molecules/BasemapSwitcher.vue';
import MapSettings from '~/components/molecules/MapSettings.vue';
import OnboardingSettings from '~/components/molecules/OnboardingSettings.vue';
import ReadingSettings from '~/components/molecules/ReadingSettings.vue';
import SearchFitSetting from '~/components/molecules/SearchFitSetting.vue';
import ThemePicker from '~/components/molecules/ThemePicker.vue';
</script>

<template>
  <div class="space-y-6">
    <!-- From sm up the basemap pill sits on the map instead. -->
    <div class="sm:hidden">
      <p class="mb-2 text-sm font-medium">Basemap</p>
      <BasemapSwitcher class="w-fit" />
    </div>
    <!-- From sm up the header's theme pill shows instead (SiteHeader.astro). -->
    <div class="sm:hidden">
      <p class="mb-2 text-sm font-medium">Theme</p>
      <ThemePicker />
    </div>
    <MapSettings />
    <section aria-labelledby="reading-settings-sheet-title">
      <h3 id="reading-settings-sheet-title" class="mb-2 font-sans text-sm font-medium">Reading and display</h3>
      <ReadingSettings in-settings />
    </section>
    <SearchFitSetting />
    <OnboardingSettings />
    <div>
      <LegalLinks />
      <BuildInfo />
    </div>
  </div>
</template>
