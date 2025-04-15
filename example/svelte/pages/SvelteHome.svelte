<script>
  let count = 0;
</script>

<svelte:head>
  <title>My Svelte Page</title>
  <meta name="description" content="This is a Svelte page with a counter.">
  <meta name="keywords" content="Svelte, JavaScript, Counter">
  <meta name="author" content="Alex Kahn">
</svelte:head>

<style>
  main {
    font-family: Arial, sans-serif;
    margin: 0 auto;
    max-width: 800px;
    padding: 1em;
  }
  header {
    background-color: #f5f5f5;
    padding: 1em;
    text-align: center;
  }
  section {
    margin-top: 1em;
  }
  #links {
    display: flex;
    flex-direction: column;
    gap: 0.5em;
  }
  a {
    color: #0077cc;
    text-decoration: none;
  }
  a:hover {
    text-decoration: underline;
  }
</style>

<main>
  <header>
    <h1>Welcome to Svelte Home</h1>
  </header>
  <section>
    <p>This is a simple Svelte page with a counter and some links.</p>
    <p>Counter: {count}</p>
    <button on:click={() => count += 1}>Increment</button>
    <div id="links">
      <a href="/link1">Link 1</a>
      <a href="/link2">Link 2</a>
      <a href="/link3">Link 3</a>
      <a href="/link4">Link 4</a>
      <a href="/link5">Link 5</a>
    </div>
  </section>
</main>
